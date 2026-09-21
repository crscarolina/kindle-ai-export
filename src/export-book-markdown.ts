import 'dotenv/config'

import fs from 'node:fs/promises'
import path from 'node:path'

import type { BookMetadata, ContentChunk } from './types'
import { parseCliArgs } from './lib/cli'
import { resolveContentPath } from './lib/content'
import { createReporter } from './lib/events'
import { renderBookMarkdown } from './lib/markdown'
import { assert, readJsonFile } from './utils'

async function main() {
  // eslint-disable-next-line no-process-env
  const opts = parseCliArgs(process.argv.slice(2), process.env)
  const reporter = createReporter({ json: opts.json })
  reporter.emit({ event: 'step-start', step: 'markdown' })

  const content = await readJsonFile<ContentChunk[]>(
    await resolveContentPath(opts.bookDir)
  )
  const metadata = await readJsonFile<BookMetadata>(
    path.join(opts.bookDir, 'metadata.json')
  )
  assert(content.length, 'no book content found')
  assert(metadata.meta, 'invalid book metadata: missing meta')
  assert(metadata.toc?.length, 'invalid book metadata: missing toc')

  const output = renderBookMarkdown({ metadata, content })
  const outFile = opts.outFile ?? path.join(opts.bookDir, 'book.md')

  await fs.mkdir(path.dirname(outFile), { recursive: true })
  await fs.writeFile(outFile, output)

  reporter.emit({ event: 'step-done', step: 'markdown' })
  reporter.emit({ event: 'done', outFile })
}

await main()
