import 'dotenv/config'

import fs from 'node:fs/promises'
import path from 'node:path'

import { parseLibraryCliArgs } from './lib/cli'
import { createReporter } from './lib/events'
import { VOICES } from './lib/voices'

/**
 * Print the Kokoro voice catalogue as JSON.
 *
 * The app reads this rather than carrying its own copy, so the picker can't
 * drift from what the narrator will actually accept.
 */
async function main() {
  // eslint-disable-next-line no-process-env
  const opts = parseLibraryCliArgs(process.argv.slice(2), process.env)
  const reporter = createReporter({ json: opts.json })

  const payload = JSON.stringify(VOICES, null, 2)

  if (opts.outFile) {
    await fs.mkdir(path.dirname(opts.outFile), { recursive: true })
    await fs.writeFile(opts.outFile, payload)
    reporter.emit({ event: 'done', outFile: opts.outFile })
  } else {
    process.stdout.write(`${payload}\n`)
  }
}

await main()
