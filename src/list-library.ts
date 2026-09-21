import 'dotenv/config'

import fs from 'node:fs/promises'
import path from 'node:path'

import { launchKindleContext } from './lib/browser'
import { parseLibraryCliArgs } from './lib/cli'
import { createReporter } from './lib/events'
import { normalizeLibraryItems } from './lib/library'

const LIBRARY_URL = 'https://read.amazon.com/kindle-library'

async function main() {
  // eslint-disable-next-line no-process-env
  const opts = parseLibraryCliArgs(process.argv.slice(2), process.env)
  const reporter = createReporter({ json: opts.json })

  await fs.mkdir(opts.userDataDir, { recursive: true })

  const context = await launchKindleContext({
    userDataDir: opts.userDataDir,
    headless: true
  })

  try {
    const page = context.pages()[0] ?? (await context.newPage())
    await page.goto(LIBRARY_URL, { timeout: 30_000 })

    // Amazon bounces signed-out requests to its sign-in form. The app has no
    // way to answer that here, so surface it and let the reader sign in from
    // Settings instead.
    if (!/\/kindle-library/.test(new URL(page.url()).pathname)) {
      reporter.emit({ event: 'session-expired' })
      process.exitCode = 1
      return
    }

    const response = await page.evaluate(async (querySize) => {
      const res = await fetch(
        `/kindle-library/search?query=&libraryType=BOOKS&sortType=recency&querySize=${querySize}`,
        { credentials: 'include' }
      )
      return res.json()
    }, opts.limit ?? 500)

    const items = normalizeLibraryItems(response)
    const outFile = opts.outFile

    if (outFile) {
      await fs.mkdir(path.dirname(outFile), { recursive: true })
      await fs.writeFile(outFile, JSON.stringify(items, null, 2))
      reporter.emit({ event: 'done', outFile })
    } else {
      process.stdout.write(`${JSON.stringify(items, null, 2)}\n`)
    }
  } finally {
    await context.close()
    await context.browser()?.close()
  }
}

await main()
