import 'dotenv/config'

import fs from 'node:fs/promises'
import path from 'node:path'

import type { LibraryItem } from './lib/library'
import { launchKindleContext } from './lib/browser'
import { parseLibraryCliArgs } from './lib/cli'
import { createReporter } from './lib/events'
import { countNavigationUnits, describePagination } from './lib/pagination'
import { assert, extractTar, tryReadJsonFile } from './utils'

const RENDER_TIMEOUT_MS = 30_000

export type PaginationReport = {
  asin: string
  title: string
  /** Page entries, 0 for none, null if the location map never arrived. */
  pages: number | null
}

/**
 * Report which books can actually be exported.
 *
 * Extraction is page-based, and Amazon gives some titles locations but no
 * print-edition page numbers. Those fail part-way through a run, so it is
 * worth knowing up front rather than per book.
 *
 * Each book has to be opened in the reader, because the page mapping only
 * arrives with the renderer's location map -- the library listing doesn't
 * carry it.
 */
async function main() {
  // eslint-disable-next-line no-process-env
  const opts = parseLibraryCliArgs(process.argv.slice(2), process.env)
  const reporter = createReporter({ json: opts.json })

  const libraryPath = path.join(path.dirname(opts.userDataDir), 'library.json')
  const library = await tryReadJsonFile<LibraryItem[]>(libraryPath)
  assert(
    library?.length,
    `no library found at ${libraryPath}; run src/list-library.ts first`
  )

  const books = opts.limit ? library.slice(0, opts.limit) : library
  const context = await launchKindleContext({
    userDataDir: opts.userDataDir,
    headless: true
  })

  let current: string | undefined
  let pages: number | null = null

  const page = context.pages()[0] ?? (await context.newPage())

  page.on('response', async (response) => {
    try {
      const url = new URL(response.url())
      if (url.pathname !== '/renderer/render') return
      if (url.searchParams.get('asin')?.toLowerCase() !== current) return
      if (url.searchParams.get('locationMap') !== 'true') return

      const dir = await extractTar(await response.body())
      try {
        pages = countNavigationUnits(
          await tryReadJsonFile(path.join(dir, 'location_map.json'))
        )
      } finally {
        await fs.rm(dir, { recursive: true, force: true })
      }
    } catch (err: any) {
      reporter.emit({
        event: 'error',
        message: `location map for ${current}: ${err?.message ?? err}`
      })
    }
  })

  const reports: PaginationReport[] = []

  try {
    for (const [index, book] of books.entries()) {
      current = book.asin.toLowerCase()
      pages = null

      try {
        await page.goto(`https://read.amazon.com/?asin=${book.asin}`, {
          timeout: 45_000
        })

        const deadline = Date.now() + RENDER_TIMEOUT_MS
        while (pages === null && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      } catch (err: any) {
        reporter.emit({
          event: 'error',
          message: `${book.asin}: ${err?.message ?? err}`
        })
      }

      reports.push({ asin: book.asin, title: book.title, pages })
      reporter.log(`${describePagination(pages).padEnd(16)}${book.title}`)
      reporter.emit({
        event: 'page',
        index,
        page: index + 1,
        total: books.length
      })
    }
  } finally {
    await context.close()
    await context.browser()?.close()
  }

  const outFile =
    opts.outFile ?? path.join(path.dirname(opts.userDataDir), 'pagination.json')
  await fs.writeFile(outFile, JSON.stringify(reports, null, 2))
  reporter.emit({ event: 'done', outFile })
}

await main()
