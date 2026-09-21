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
import { assert, readJsonFile } from './utils'

/** Characters of book text per `claude` invocation. */
const BATCH_CHARS = 16_000
const CLAUDE_MODEL = 'sonnet'

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
    child.stdout.on('data', (data) => (stdout += data))
    child.stderr.on('data', (data) => (stderr += data))

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`claude exited with ${code}: ${stderr.slice(0, 500)}`))
      }
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

  const cleanedBatches = await pMap(
    batches,
    async (batch) => {
      try {
        const raw = await runClaude(buildCleanupPrompt(batch))
        return applyCleanup(batch, parseCleanupResponse(raw))
      } catch (err: any) {
        // A failed batch keeps its original text rather than failing the book.
        reporter.emit({
          event: 'error',
          message: `cleanup batch failed, keeping original text: ${err.message}`
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
      }
    },
    { concurrency: 3 }
  )

  const outFile = opts.outFile ?? path.join(opts.bookDir, 'content.clean.json')
  await fs.mkdir(path.dirname(outFile), { recursive: true })
  await fs.writeFile(outFile, JSON.stringify(cleanedBatches.flat(), null, 2))

  reporter.emit({ event: 'step-done', step: 'clean' })
  reporter.emit({ event: 'done', outFile })
}

await main()
