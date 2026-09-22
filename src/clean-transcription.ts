import 'dotenv/config'

import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

import pMap from 'p-map'

import type { ContentChunk } from './types'
import {
  applyCleanup,
  batchChunks,
  buildCleanupPrompt,
  CLEANUP_SYSTEM_PROMPT,
  parseCleanupResponse
} from './lib/cleanup'
import {
  batchFileName,
  buildOrchestratorPrompt,
  missingBatchIndices
} from './lib/cleanup-orchestration'
import { parseCliArgs } from './lib/cli'
import { createReporter } from './lib/events'
import {
  describeRemaining,
  estimateRemainingMs,
  formatDuration
} from './lib/progress'
import { assert, readJsonFile } from './utils'

/** Characters of book text per `claude` invocation. */
const BATCH_CHARS = 16_000

/**
 * The model doing the repair.
 *
 * Haiku was measured on the same four pages and rejected: it made the small
 * fixes (em-dashes, quote marks) but added no paragraph breaks at all,
 * leaving the OCR's hard line wraps intact. Restoring paragraphs is the whole
 * point of the pass, so the throughput is not worth having.
 */
const CLAUDE_MODEL = 'sonnet'

/**
 * Subagents the orchestrating session runs at once.
 *
 * Wall-clock scales close to linearly with this, since each batch spends
 * almost all its time generating. Measured on a 741-page book: 73 batches at
 * roughly 55s each took 23 minutes at 3.
 */
const CONCURRENCY = 6

/**
 * How long the whole orchestrated run may take.
 *
 * Generous, because it covers every batch: a novel is over an hour of
 * generation even with subagents in parallel.
 */
const ORCHESTRATOR_TIMEOUT_MS = 3 * 60 * 60 * 1000
/**
 * A batch that hasn't answered in this long is treated as stuck.
 *
 * Without it, a `claude` that blocks -- not logged in, or waiting on a
 * prompt -- leaves the promise unsettled and the whole export hangs with no
 * progress and no way to cancel.
 */
const BATCH_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Run one batch through the `claude` CLI.
 *
 * Deliberately the CLI rather than the API: it reuses the reader's existing
 * Claude Code session, so a full novel costs nothing beyond their
 * subscription instead of roughly a dollar-per-chapter of metered tokens.
 */
async function runClaude(
  prompt: string,
  {
    args = [],
    timeoutMs = BATCH_TIMEOUT_MS
  }: { args?: string[]; timeoutMs?: number } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      [
        '-p',
        // Not `--bare`: it starts in ~0.9s against ~4.3s, but does not carry
        // the logged-in session. It prints "Not logged in" and exits 0, which
        // reads as a successful batch that simply changed nothing.
        '--output-format',
        'text',
        '--model',
        CLAUDE_MODEL,
        '--append-system-prompt',
        CLEANUP_SYSTEM_PROMPT,
        ...args
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(() => reject(new Error(`claude timed out after ${timeoutMs}ms`)))
    }, timeoutMs)

    child.stdout.on('data', (data) => (stdout += data))
    child.stderr.on('data', (data) => (stderr += data))

    child.on('error', (err) => finish(() => reject(err)))

    // Writing to a child that failed to spawn raises here rather than on the
    // child itself, and an unhandled stream error would take down the run
    // instead of falling back to the original text.
    child.stdin.on('error', (err) => finish(() => reject(err)))

    child.on('close', (code) => {
      finish(() => {
        if (code === 0) {
          resolve(stdout)
        } else {
          reject(
            new Error(`claude exited with ${code}: ${stderr.slice(0, 500)}`)
          )
        }
      })
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })
}

async function main() {
  // eslint-disable-next-line no-process-env
  const opts = parseCliArgs(process.argv.slice(2), process.env)
  const reporter = createReporter({ json: opts.json })
  reporter.emit({ event: 'step-start', step: 'clean' })

  const content = await readJsonFile<ContentChunk[]>(
    path.join(opts.bookDir, 'content.json')
  )
  assert(content.length, 'no book content found')

  const chunks = opts.limit ? content.slice(0, opts.limit) : content
  const batches = batchChunks(chunks, BATCH_CHARS)

  // Batches go to disk rather than through the orchestrator's prompt: a novel
  // is around a million characters, far past what one context can hold.
  const workDir = path.join(opts.bookDir, 'cleanup')
  const inDir = path.join(workDir, 'in')
  const outDir = path.join(workDir, 'out')
  await fs.rm(workDir, { recursive: true, force: true })
  await fs.mkdir(inDir, { recursive: true })
  await fs.mkdir(outDir, { recursive: true })

  await Promise.all(
    batches.map((batch, index) =>
      fs.writeFile(
        path.join(inDir, batchFileName(index)),
        buildCleanupPrompt(batch)
      )
    )
  )

  reporter.log(
    `cleaning ${chunks.length} page${chunks.length === 1 ? '' : 's'} in ${batches.length} batch${batches.length === 1 ? '' : 'es'}, ${CONCURRENCY} subagents at a time`
  )

  const startedAt = Date.now()

  // Report progress from the files appearing on disk. The orchestrator is a
  // model driving a long loop, so its own account of how far it has got is
  // not something to build a progress bar on.
  let finished = false
  const watcher = (async () => {
    let seen = 0
    while (!finished) {
      await new Promise((resolve) => setTimeout(resolve, 3000))

      const done = missingBatchIndices(
        batches.length,
        await fs.readdir(outDir).catch(() => [])
      )
      const completed = batches.length - done.length
      if (completed === seen) continue
      seen = completed

      reporter.emit({
        event: 'page',
        index: completed - 1,
        page: completed,
        total: batches.length
      })

      const eta =
        completed >= CONCURRENCY
          ? describeRemaining(
              estimateRemainingMs({
                completed,
                total: batches.length,
                elapsedMs: Date.now() - startedAt
              })
            )
          : undefined

      reporter.log(
        `${completed}/${batches.length} batches cleaned${eta ? `, ${eta}` : ''}`
      )
    }
  })()

  try {
    await runClaude(
      buildOrchestratorPrompt({
        inDir,
        outDir,
        total: batches.length,
        concurrency: CONCURRENCY
      }),
      {
        args: [
          '--permission-mode',
          'acceptEdits',
          '--allowedTools',
          'Read,Write,Glob,Task',
          '--add-dir',
          workDir
        ],
        timeoutMs: ORCHESTRATOR_TIMEOUT_MS
      }
    )
  } catch (err: any) {
    // Not fatal: whatever the orchestrator did produce is still usable, and
    // the rest is retried below.
    reporter.emit({
      event: 'error',
      message: `orchestrator stopped early: ${err.message}`
    })
  } finally {
    finished = true
    await watcher
  }

  // "It said it finished" is not evidence; the files are.
  let missing = missingBatchIndices(
    batches.length,
    await fs.readdir(outDir).catch(() => [])
  )

  if (missing.length) {
    reporter.log(
      `${missing.length} batch${missing.length === 1 ? '' : 'es'} missing; retrying individually`
    )

    await pMap(
      missing,
      async (index) => {
        try {
          const raw = await runClaude(
            await fs.readFile(path.join(inDir, batchFileName(index)), 'utf8')
          )
          if (parseCleanupResponse(raw).size === 0) {
            throw new Error('claude returned no recognisable chunks')
          }
          await fs.writeFile(path.join(outDir, batchFileName(index)), raw)
        } catch (err: any) {
          reporter.emit({
            event: 'error',
            message: `batch ${index} failed, keeping original text: ${err.message}`
          })
        }
      },
      { concurrency: CONCURRENCY }
    )

    missing = missingBatchIndices(
      batches.length,
      await fs.readdir(outDir).catch(() => [])
    )
  }

  let fellBack = 0
  const cleanedBatches = await pMap(
    batches,
    async (batch, index) => {
      const raw = await fs
        .readFile(path.join(outDir, batchFileName(index)), 'utf8')
        .catch(() => '')
      const cleaned = parseCleanupResponse(raw)

      if (cleaned.size === 0) {
        fellBack++
        return batch
      }

      return applyCleanup(batch, cleaned)
    },
    { concurrency: 8 }
  )

  reporter.log(
    fellBack
      ? `${fellBack} of ${batches.length} batches kept their original text`
      : `all ${batches.length} batches cleaned`
  )
  reporter.log(
    `cleanup took ${formatDuration((Date.now() - startedAt) / 1000)}`
  )

  const outFile = opts.outFile ?? path.join(opts.bookDir, 'content.clean.json')
  await fs.mkdir(path.dirname(outFile), { recursive: true })
  await fs.writeFile(outFile, JSON.stringify(cleanedBatches.flat(), null, 2))

  reporter.emit({ event: 'step-done', step: 'clean' })
  reporter.emit({ event: 'done', outFile })
}

await main()
