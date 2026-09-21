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
const CLAUDE_MODEL = 'sonnet'
/** Simultaneous `claude` processes. */
const CONCURRENCY = 3
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
async function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      [
        '-p',
        '--output-format',
        'text',
        '--model',
        CLAUDE_MODEL,
        '--append-system-prompt',
        CLEANUP_SYSTEM_PROMPT
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
      finish(() =>
        reject(new Error(`claude timed out after ${BATCH_TIMEOUT_MS}ms`))
      )
    }, BATCH_TIMEOUT_MS)

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
  let completed = 0
  let fellBack = 0

  reporter.log(
    `cleaning ${chunks.length} page${chunks.length === 1 ? '' : 's'} in ${batches.length} batch${batches.length === 1 ? '' : 'es'}, ${CONCURRENCY} at a time`
  )

  const startedAt = Date.now()

  const cleanedBatches = await pMap(
    batches,
    async (batch) => {
      const batchStartedAt = Date.now()

      try {
        const raw = await runClaude(buildCleanupPrompt(batch))
        return applyCleanup(batch, parseCleanupResponse(raw))
      } catch (err: any) {
        // A failed batch keeps its original text rather than failing the book.
        fellBack++
        reporter.emit({
          event: 'error',
          message: `cleanup batch failed, keeping original text (${fellBack} of ${batches.length} so far): ${err.message}`
        })
        return batch
      } finally {
        completed++
        reporter.emit({
          event: 'page',
          index: completed - 1,
          page: completed,
          total: batches.length
        })

        // Batches finish out of order under concurrency, so this counts
        // completions rather than naming which batch it was.
        const remainingMs = estimateRemainingMs({
          completed,
          total: batches.length,
          elapsedMs: Date.now() - startedAt
        })
        // Until every worker has landed once, the measured rate is one
        // batch's latency rather than the pipeline's throughput, and would
        // overstate the time left by roughly the concurrency.
        const eta =
          completed >= CONCURRENCY ? describeRemaining(remainingMs) : undefined

        reporter.log(
          `batch ${completed}/${batches.length} in ${formatDuration((Date.now() - batchStartedAt) / 1000)}${eta ? `, ${eta}` : ''}`
        )
      }
    },
    { concurrency: CONCURRENCY }
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
