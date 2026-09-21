import 'dotenv/config'

import fs from 'node:fs/promises'
import path from 'node:path'

import { launchKindleContext } from './lib/browser'
import { parseLibraryCliArgs } from './lib/cli'
import { createReporter } from './lib/events'
import {
  collectLibraryPages,
  type LibraryPageFetcher,
  mergeLibraryPages
} from './lib/library'

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

    // The request runs inside the page so it carries the reader's cookies.
    // The AbortController bounds the request itself; `collectLibraryPages`
    // separately bounds the `evaluate`, which Playwright will otherwise wait
    // on forever if the page stops answering.
    const fetchPage: LibraryPageFetcher = (url, { timeoutMs }) =>
      page.evaluate(
        async ([target, ms]) => {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), ms)

          try {
            const res = await fetch(target, {
              credentials: 'include',
              signal: controller.signal
            })

            if (!res.ok) {
              throw new Error(`HTTP ${res.status} ${res.statusText}`)
            }

            return await res.json()
          } finally {
            clearTimeout(timer)
          }
        },
        [url, timeoutMs] as [string, number]
      )

    // Amazon caps a page at 50 and hands back a token for the next, so the
    // whole library takes several requests.
    const pages = await collectLibraryPages({
      fetchPage,
      limit: opts.limit,
      onPage: ({ page: pageNumber, fetched, hasMore }) => {
        reporter.emit({
          event: 'page',
          index: pageNumber - 1,
          page: pageNumber,
          total: pageNumber + (hasMore ? 1 : 0)
        })
        // The library refresh has no progress bar in the app -- it renders
        // the log -- so every page has to say something there, or a slow
        // listing is indistinguishable from a frozen window.
        reporter.log(`${fetched} books so far`)
      },
      onWarning: (message) => reporter.emit({ event: 'error', message })
    })

    const merged = mergeLibraryPages(pages)
    const items = opts.limit ? merged.slice(0, opts.limit) : merged
    reporter.log(`${items.length} books across ${pages.length} pages`)
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
