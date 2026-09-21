import 'dotenv/config'

import fs from 'node:fs/promises'
import path from 'node:path'

import { launchKindleContext } from './lib/browser'
import { parseLibraryCliArgs } from './lib/cli'
import { createReporter } from './lib/events'
import {
  buildLibrarySearchUrl,
  LIBRARY_PAGE_SIZE,
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

    // Amazon caps a page at 50 and hands back a token for the next, so the
    // whole library takes several requests.
    const pages: unknown[] = []
    let paginationToken: string | undefined

    for (;;) {
      const body: any = await page.evaluate(
        (url) =>
          fetch(url, { credentials: 'include' }).then((res) => res.json()),
        buildLibrarySearchUrl({ paginationToken })
      )

      pages.push(body)
      const count = body?.itemsList?.length ?? 0
      reporter.emit({
        event: 'page',
        index: pages.length - 1,
        page: pages.length,
        total: pages.length + (body?.paginationToken ? 1 : 0)
      })

      paginationToken = body?.paginationToken
      if (!paginationToken || count < LIBRARY_PAGE_SIZE) break
      if (opts.limit && pages.length * LIBRARY_PAGE_SIZE >= opts.limit) break
    }

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
