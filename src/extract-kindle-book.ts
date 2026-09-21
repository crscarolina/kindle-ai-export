import 'dotenv/config'

import fs from 'node:fs/promises'
import path from 'node:path'

import type { SetRequired } from 'type-fest'
import { input } from '@inquirer/prompts'
import delay from 'delay'
import pRace from 'p-race'
// import { chromium } from 'playwright'
import { chromium } from 'patchright'
import sharp from 'sharp'

import type {
  AmazonBookMeta,
  AmazonRenderLocationMap,
  AmazonRenderMetadata,
  AmazonRenderToc,
  AmazonRenderTocItem,
  BookMetadata,
  TocItem
} from './types'
import { createBookIndex } from './lib/book-index'
import { parseCliArgs } from './lib/cli'
import { createReporter } from './lib/events'
import { captureProgress } from './lib/progress'
import { planExtractionResume, scanCompletedPages } from './lib/resume'
import { navUnitValue, parsePageNav, parseTocItems } from './playwright-utils'
import {
  assert,
  extractTar,
  getEnv,
  hashObject,
  normalizeAuthors,
  normalizeBookMetadata,
  parseInlineStartReadingResponse,
  parseJsonpResponse,
  tryReadJsonFile
} from './utils'

// Block amazon analytics requests
// (not strictly necessary, but adblockers do this by default anyway and it
// makes the script run a bit faster)
const urlRegexBlacklist = [
  /unagi-\w+\.amazon\.com/i, // 'unagi-na.amazon.com'
  /m\.media-amazon\.com.*\/showads/i,
  /fls-na\.amazon\.com.*\/remote-weblab-triggers/i
]

type RENDER_METHOD = 'screenshot' | 'blob'
const renderMethod: RENDER_METHOD = 'blob'

async function main() {
  // eslint-disable-next-line no-process-env
  const opts = parseCliArgs(process.argv.slice(2), process.env)
  const reporter = createReporter({ json: opts.json })
  reporter.emit({ event: 'step-start', step: 'extract' })

  const asin = opts.asin
  const amazonEmail = getEnv('AMAZON_EMAIL')
  const amazonPassword = getEnv('AMAZON_PASSWORD')
  assert(amazonEmail, 'AMAZON_EMAIL is required')
  assert(amazonPassword, 'AMAZON_PASSWORD is required')
  const asinL = asin.toLowerCase()

  const outDir = opts.bookDir
  const userDataDir = opts.userDataDir
  const pageScreenshotsDir = path.join(outDir, 'pages')
  const metadataPath = path.join(outDir, 'metadata.json')
  await fs.mkdir(userDataDir, { recursive: true })
  await fs.mkdir(pageScreenshotsDir, { recursive: true })

  const krRendererMainImageSelector = '#kr-renderer .kg-full-page-img img'
  const bookReaderUrl = `https://read.amazon.com/?asin=${asin}`

  const result: SetRequired<Partial<BookMetadata>, 'pages' | 'nav'> = {
    pages: [],
    // locationMap: { locations: [], navigationUnit: [] },
    nav: {
      unit: 'page',
      startPosition: -1,
      endPosition: -1,
      startContentPosition: -1,
      startContentPage: -1,
      endContentPosition: -1,
      endContentPage: -1,
      totalNumPages: -1,
      totalNumContentPages: -1
    }
  }

  let bookIndex: ReturnType<typeof createBookIndex> | undefined

  // Fallback source for book meta, since Kindle's reader no longer fetches
  // `YJmetadata.jsonp`
  let renderMetadata: AmazonRenderMetadata | undefined

  const deviceScaleFactor = 2
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    args: [
      // hide chrome's crash restore popup
      '--hide-crash-restore-bubble',
      // disable chrome's password autosave popups
      '--disable-features=PasswordAutosave',
      // disable chrome's passkey popups
      '--disable-features=WebAuthn',
      // disable chrome creating 1GB temp directories on each run
      '--disable-features=MacAppCodeSignClone'
    ],
    ignoreDefaultArgs: [
      // disable chrome's default automation detection flag
      '--enable-automation',
      // adding this cause chrome shows a weird admin popup without it
      '--no-sandbox',
      // adding this cause chrome shows a weird admin popup without it
      '--disable-blink-features=AutomationControlled'
    ],
    // bypass amazon's default content security policy which allows us to inject
    // our own scripts into the page
    bypassCSP: true,
    deviceScaleFactor,
    viewport: { width: 1280, height: 720 }
  })

  const page = context.pages()[0] ?? (await context.newPage())

  await page.route('**/*', async (route) => {
    const urlString = route.request().url()
    for (const regex of urlRegexBlacklist) {
      if (regex.test(urlString)) {
        return route.abort()
      }
    }

    return route.continue()
  })

  page.on('response', async (response) => {
    try {
      const status = response.status()
      if (status !== 200) {
        return
      }

      const url = new URL(response.url())
      if (url.pathname.endsWith('YJmetadata.jsonp')) {
        const body = await response.text()
        const metadata = parseJsonpResponse<any>(body)
        if (metadata.asin !== asin) return

        delete metadata.cpr
        if (Array.isArray(metadata.authorsList)) {
          metadata.authorsList = normalizeAuthors(metadata.authorsList)
        }

        if (!result.meta) {
          console.warn('book meta', metadata)
          result.meta = metadata
        }
      } else if (
        url.hostname === 'read.amazon.com' &&
        url.searchParams.get('asin')?.toLowerCase() === asinL
      ) {
        if (url.pathname === '/service/mobile/reader/startReading') {
          const body: any = await response.json()
          delete body.karamelToken
          delete body.metadataUrl
          delete body.YJFormatVersion
          if (!result.info) {
            console.warn('book info', body)
          }
          result.info = body
        } else if (url.pathname === '/renderer/render') {
          // TODO: these TAR files have some useful metadata that we could use...
          const params = Object.fromEntries(url.searchParams.entries())
          const hash = hashObject(params)
          const renderDir = path.join(outDir, 'render', hash)
          await fs.mkdir(renderDir, { recursive: true })
          const body = await response.body()
          const tempDir = await extractTar(body, { cwd: renderDir })
          const { startingPosition, skipPageCount, numPage } = params
          console.log('RENDER TAR', tempDir, {
            startingPosition,
            skipPageCount,
            numPage
          })

          const locationMap = await tryReadJsonFile<AmazonRenderLocationMap>(
            path.join(renderDir, 'location_map.json')
          )
          if (locationMap) {
            result.locationMap = locationMap

            for (const navUnit of result.locationMap.navigationUnit ?? []) {
              navUnit.page = Number.parseInt(navUnit.label, 10)
              assert(
                !Number.isNaN(navUnit.page),
                `invalid locationMap page number: ${navUnit.label}`
              )
            }
          }

          const metadata = await tryReadJsonFile<AmazonRenderMetadata>(
            path.join(renderDir, 'metadata.json')
          )
          if (metadata) {
            renderMetadata = metadata
            result.nav.startPosition = metadata.firstPositionId
            result.nav.endPosition = metadata.lastPositionId
          }

          const rawToc = await tryReadJsonFile<AmazonRenderToc>(
            path.join(renderDir, 'toc.json')
          )
          if (rawToc && result.locationMap && !result.toc) {
            const toc: TocItem[] = []

            for (const rawTocItem of rawToc) {
              toc.push(...getTocItems(rawTocItem, { depth: 0 }))
            }

            result.toc = toc
          }

          // TODO: `page_data_0_5.json` has start/end/words for each page in this render batch
          // const toc = JSON.parse(
          //   await fs.readFile(path.join(tempDir, 'toc.json'), 'utf8')
          // )
          // console.warn('toc', toc)
        }
      }
    } catch (err: any) {
      console.warn(
        'error handling response',
        response.url(),
        err?.message ?? err
      )
    }
  })

  // Only used for the 'blob' render method
  const capturedBlobs = new Map<
    string,
    {
      type: string
      base64: string
    }
  >()

  if (renderMethod === 'blob') {
    await page.exposeFunction('nodeLog', (...args: any[]) => {
      console.error('[page]', ...args)
    })

    await page.exposeBinding('captureBlob', (_source, url, payload) => {
      capturedBlobs.set(url, payload)
    })

    await context.addInitScript(() => {
      const origCreateObjectURL = URL.createObjectURL.bind(URL)
      URL.createObjectURL = function (blob: Blob) {
        // TODO: filter for image/png blobs? since those are the only ones we're using
        // (haven't found this to be an issue in practice)
        const type = blob.type || 'application/octet-stream'
        const url = origCreateObjectURL(blob)
        // nodeLog('createObjectURL', url, type, blob.size)

        // Snapshot blob bytes immediately because kindle's renderer revokes
        // them immediately after they're used.
        ;(async () => {
          const buf = await blob.arrayBuffer()
          // store raw base64 (not data URL) to keep payload small
          let binary = ''
          const bytes = new Uint8Array(buf)
          for (const byte of bytes) {
            // eslint-disable-next-line unicorn/prefer-code-point
            binary += String.fromCharCode(byte)
          }

          const base64 = btoa(binary)

          // @ts-expect-error captureBlob
          captureBlob(url, { type, base64 })
        })()

        return url
      }
    })
  }

  // Try going directly to the book reader page if we're already authenticated.
  // Otherwise wait for the signin page to load.
  await Promise.any([
    page.goto(bookReaderUrl, { timeout: 30_000 }),
    page.waitForURL('**/ap/signin', { timeout: 30_000 })
  ])

  // If we're on the signin page, start the authentication flow.
  if (/\/ap\/signin/g.test(new URL(page.url()).pathname)) {
    await page.locator('input[type="email"]').fill(amazonEmail)
    await page.locator('input[type="submit"]').click()

    await page.locator('input[type="password"]').fill(amazonPassword)
    // await page.locator('input[type="checkbox"]').click()
    await page.locator('input[type="submit"]').first().click()

    if (!/\/kindle-library/g.test(new URL(page.url()).pathname)) {
      if (opts.json) {
        reporter.emit({ event: 'session-expired' })
        throw new Error(
          'Amazon session expired; sign in again from the app settings'
        )
      }

      const code = await input({
        message: '2-factor auth code?'
      })

      // Only enter 2-factor auth code if needed
      if (code) {
        await page.locator('input[type="tel"]').fill(code)
        await page
          .locator(
            'input[type="submit"][aria-labelledby="cvf-submit-otp-button-announce"]'
          )
          .click()
      }
    }

    if (!page.url().includes(bookReaderUrl)) {
      await page.goto(bookReaderUrl)
    }
  }

  async function updateSettings() {
    // The sync dialog can surface at any point while the reader settles, so
    // one failed click is worth a second attempt after clearing it rather
    // than failing the whole extraction.
    try {
      await applyReaderSettings()
    } catch (err: any) {
      if (!(await dismissPossibleAlert({ timeout: 500 }))) {
        throw err
      }
      reporter.log('cleared a reader dialog; reapplying reader settings')
      await applyReaderSettings()
    }
  }

  async function applyReaderSettings() {
    console.log('Looking for Reader settings button')
    const settingsButton = page
      .locator(
        'ion-button[aria-label="Reader settings"], ' +
          'button[aria-label="Reader settings"]'
      )
      .first()
    await settingsButton.waitFor({ timeout: 30_000 })
    console.log('Clicking Reader settings')
    await settingsButton.click()
    await delay(500)

    // Change font to Amazon Ember
    // My hypothesis is that this font will be easier for OCR to transcribe...
    // TODO: evaluate different fonts & settings
    console.log('Changing font to Amazon Ember')
    await page.locator('#AmazonEmber').click()
    await delay(200)

    // Change layout to single column
    console.log('Changing to single column layout')
    await page
      .locator('[role="radiogroup"][aria-label$=" columns"]', {
        hasText: 'Single Column'
      })
      .click()
    await delay(200)

    console.log('Closing settings')
    await settingsButton.click()
    await delay(500)
  }

  async function goToPage(pageNumber: number) {
    await page.locator('#reader-header').hover({ force: true })
    await delay(200)
    await page.locator('ion-button[aria-label="Reader menu"]').click()
    await delay(500)
    await page
      .locator('ion-item[role="listitem"]')
      .filter({ hasText: /go to (page|location)/i })
      .first()
      .click()
    await page.locator('ion-modal input').first().fill(`${pageNumber}`)
    // await page.locator('ion-modal button', { hasText: 'Go' }).click()
    await page
      .locator('ion-modal ion-button[item-i-d="go-to-modal-go-button"]')
      .click()
    await delay(500)
  }

  async function getPageNav() {
    const footerText = await page
      .locator('ion-footer ion-title')
      .first()
      .textContent()
    return parsePageNav(footerText)
  }

  async function ensureFixedHeaderUI() {
    await page.locator('.top-chrome').evaluate((el) => {
      el.style.transition = 'none'
      el.style.transform = 'none'
    })
  }

  /**
   * Clear any reader dialog standing in front of the page.
   *
   * The one that matters is "Most Recent Page Read", offering to jump to
   * wherever the book was last left. It appears a moment *after* the reader
   * loads, so checking once on arrival misses it, and its backdrop then
   * swallows every click aimed at anything behind it -- which surfaces much
   * later as an unrelated-looking timeout clicking a settings button.
   *
   * Always declines: the extractor drives its own position.
   */
  async function dismissPossibleAlert({
    timeout = 2000
  } = {}): Promise<boolean> {
    const $alert = page.locator('ion-alert').first()

    try {
      await $alert.waitFor({ state: 'visible', timeout })
    } catch {
      return false
    }

    for (const label of ['No', 'Cancel', 'Dismiss', 'Not Now']) {
      const $button = $alert.locator('button', { hasText: label }).first()
      if ((await $button.count()) > 0) {
        await $button.click({ timeout: 5000 }).catch(() => {})
        await $alert.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
        return true
      }
    }

    reporter.log('a reader dialog is open and has no button we recognise')
    return false
  }

  async function getLibraryAuthors(): Promise<string[]> {
    try {
      const rawAuthors: string[] | undefined = await page.evaluate(
        async (asin) => {
          const res = await fetch(
            `/kindle-library/search?query=${asin}&libraryType=BOOKS&sortType=recency&querySize=5`,
            { credentials: 'include' }
          )
          const body: any = await res.json()
          return body.itemsList?.find((item: any) => item.asin === asin)
            ?.authors
        },
        asin
      )
      return normalizeAuthors(rawAuthors ?? [])
    } catch (err: any) {
      console.warn('unable to fetch book authors from library', err.message)
      return []
    }
  }

  async function writeResultMetadata() {
    return fs.writeFile(
      metadataPath,
      JSON.stringify(normalizeBookMetadata(result), null, 2)
    )
  }

  function getTocItems(
    rawTocItem: AmazonRenderTocItem,
    { depth = 0 }: { depth?: number } = {}
  ): TocItem[] {
    const positionId = rawTocItem.tocPositionId
    const page = getPageForPosition(positionId)

    const tocItem: TocItem = {
      label: rawTocItem.label,
      positionId,
      page,
      depth
    }

    const tocItems: TocItem[] = [tocItem]

    if (rawTocItem.entries) {
      for (const rawTocItemEntry of rawTocItem.entries) {
        tocItems.push(...getTocItems(rawTocItemEntry, { depth: depth + 1 }))
      }
    }

    return tocItems
  }

  function getPageForPosition(position: number): number {
    if (!result.locationMap) return -1

    // Built lazily: the location map arrives from a network response, so it
    // isn't available when this closure is created.
    bookIndex ??= createBookIndex(result.locationMap)
    return bookIndex.unitForPosition(position)
  }

  await dismissPossibleAlert()
  await ensureFixedHeaderUI()
  await updateSettings()

  console.log('Waiting for book reader to load...')
  await page
    .waitForSelector(krRendererMainImageSelector, { timeout: 60_000 })
    .catch(() => {
      console.warn(
        'Main reader content may not have loaded, continuing anyway...'
      )
    })

  // Record the initial page navigation so we can reset back to it later
  const initialPageNav = await getPageNav()

  if (!result.info) {
    // Kindle's reader now inlines the `startReading` response into the page
    // instead of fetching it. (We read it from the DOM because patchright's
    // document interception hides the reader page's response from us.)
    const body = parseInlineStartReadingResponse<any>(await page.content())
    if (body) {
      delete body.renderingInfo
      console.warn('book info', body)
      result.info = body
    }
  }

  if (!result.meta && renderMetadata) {
    // Kindle's reader no longer fetches `YJmetadata.jsonp`, so fall back to
    // the renderer's metadata plus the author list from the library search.
    console.warn('book meta not found; falling back to renderer metadata')
    result.meta = {
      asin,
      title: renderMetadata.bookTitle,
      authorList: await getLibraryAuthors(),
      language: renderMetadata.lang,
      version: result.info?.contentVersion,
      startPosition: renderMetadata.firstPositionId,
      endPosition: renderMetadata.lastPositionId
    } as AmazonBookMeta
    console.warn('book meta', result.meta)
  }

  // At this point, we should have recorded all the base book metadata from the
  // initial network requests.
  assert(result.info, 'expected book info to be initialized')
  assert(
    result.meta,
    'expected book meta to be initialized (no YJmetadata.jsonp and no renderer metadata was captured -- check the response warnings above)'
  )
  assert(result.toc?.length, 'expected book toc to be initialized')
  assert(result.locationMap, 'expected book location map to be initialized')

  bookIndex ??= createBookIndex(result.locationMap)
  result.nav.unit = bookIndex.unit

  if (bookIndex.unit === 'location') {
    reporter.log(
      `"${result.meta.title}" has no print-edition pagination; indexing by Kindle location instead`
    )
  }

  result.nav.startContentPosition = result.meta.startPosition
  result.nav.totalNumPages = bookIndex.total
  assert(
    result.nav.totalNumPages > 0,
    `parsed book nav has no ${bookIndex.unit}s`
  )
  result.nav.startContentPage = getPageForPosition(
    result.nav.startContentPosition
  )

  const parsedToc = parseTocItems(result.toc, {
    totalNumPages: result.nav.totalNumPages
  })
  result.nav.endContentPage =
    parsedToc.firstPostContentPageTocItem?.page ?? result.nav.totalNumPages
  result.nav.endContentPosition =
    parsedToc.firstPostContentPageTocItem?.positionId ?? result.nav.endPosition

  result.nav.totalNumContentPages = Math.min(
    parsedToc.firstPostContentPageTocItem?.page ?? result.nav.totalNumPages,
    result.nav.totalNumPages
  )
  assert(result.nav.totalNumContentPages > 0, 'No content pages found')
  const pageNumberPaddingAmount = `${result.nav.totalNumContentPages * 2}`
    .length
  const screenshotName = (index: number, page: number) =>
    `${index}`.padStart(pageNumberPaddingAmount, '0') +
    '-' +
    `${page}`.padStart(pageNumberPaddingAmount, '0') +
    '.png'
  await writeResultMetadata()

  // Pick up an interrupted run rather than re-screenshotting the whole book.
  const resumePlan = opts.force
    ? { resumePage: undefined, keep: [] }
    : planExtractionResume(
        scanCompletedPages(await fs.readdir(pageScreenshotsDir).catch(() => []))
      )

  if (resumePlan.keep.length) {
    const previousPages = new Map(
      ((await tryReadJsonFile<BookMetadata>(metadataPath))?.pages ?? []).map(
        (pageChunk) => [pageChunk.index, pageChunk]
      )
    )

    result.pages = resumePlan.keep.map(
      ({ index, page }) =>
        previousPages.get(index) ?? {
          index,
          page,
          screenshot: path.join(pageScreenshotsDir, screenshotName(index, page))
        }
    )

    reporter.log(
      `resuming from page ${resumePlan.resumePage} (${result.pages.length} pages already captured)`
    )
  }

  // Navigate to the first content page of the book
  await goToPage(resumePlan.resumePage ?? result.nav.startContentPage)

  let done = false
  reporter.log(
    `reading ${result.nav.totalNumContentPages} content ${result.nav.unit}s out of ${result.nav.totalNumPages} total`
  )

  // Loop through each page of the book
  do {
    const pageNav = await getPageNav()

    const navValue = navUnitValue(pageNav)

    if (navValue === undefined) {
      break
    }

    if (navValue > result.nav.totalNumContentPages) {
      break
    }

    if (opts.limit !== undefined && result.pages.length >= opts.limit) {
      break
    }

    const index = result.pages.length

    const src = (await page
      .locator(krRendererMainImageSelector)
      .getAttribute('src'))!

    let renderedPageImageBuffer: Buffer | undefined

    if (renderMethod === 'blob') {
      const blob = await pRace<{ type: string; base64: string } | undefined>(
        (signal) => [
          (async () => {
            while (!signal.aborted) {
              const blob = capturedBlobs.get(src)

              if (blob) {
                capturedBlobs.delete(src)
                return blob
              }

              await delay(1)
            }
          })(),

          delay(10_000, { signal })
        ]
      )

      assert(
        blob,
        `no blob found for src: ${src} (index ${index}; ${result.nav.unit} ${navValue})`
      )

      const rawRenderedImage = Buffer.from(blob.base64, 'base64')
      const c = sharp(rawRenderedImage)
      const m = await c.metadata()
      renderedPageImageBuffer = await c
        .resize({
          width: Math.floor(m.width / deviceScaleFactor),
          height: Math.floor(m.height / deviceScaleFactor)
        })
        .png({ quality: 90 })
        .toBuffer()
    } else {
      renderedPageImageBuffer = await page
        .locator(krRendererMainImageSelector)
        .screenshot({ type: 'png', scale: 'css' })
    }

    assert(
      renderedPageImageBuffer,
      `no buffer found for src: ${src} (index ${index}; ${result.nav.unit} ${navValue})`
    )

    const screenshotPath = path.join(
      pageScreenshotsDir,
      screenshotName(index, navValue)
    )

    await fs.writeFile(screenshotPath, renderedPageImageBuffer)
    const pageChunk = {
      index,
      page: navValue,
      screenshot: screenshotPath
    }
    result.pages.push(pageChunk)

    // Progress is counted in the book's own units, not screenshots. One page
    // spans several screenshots, so reporting the screenshot counter against a
    // page total produced nonsense like "741/652".
    reporter.emit({
      event: 'page',
      page: navValue,
      ...captureProgress({
        current: navValue,
        start: result.nav.startContentPage,
        total: result.nav.totalNumContentPages,
        limit: opts.limit
      })
    })
    await writeResultMetadata()

    // The reader has no next-page chevron on the final page, so trying to
    // advance costs 30 retries of 5s timeouts -- minutes of looking hung at
    // the very end of a book that is in fact complete.
    if (navValue >= result.nav.totalNumContentPages) {
      reporter.log(
        `reached the last ${result.nav.unit} (${navValue}); extraction complete`
      )
      break
    }

    let retries = 0

    do {
      // This delay seems to help speed up the navigation process, possibly due
      // to the navigation chevron needing time to settle.
      await delay(100)

      let navigationTimeout = 10_000
      try {
        // await page.keyboard.press('ArrowRight')
        await page
          .locator('.kr-chevron-container-right')
          .click({ timeout: 5000 })
      } catch (err: any) {
        console.warn('unable to click next page button', err.message, pageNav)
        navigationTimeout = 1000
      }

      const navigatedToNextPage = await pRace<boolean | undefined>((signal) => [
        (async () => {
          while (!signal.aborted) {
            const newSrc = await page
              .locator(krRendererMainImageSelector)
              .getAttribute('src')

            if (newSrc && newSrc !== src) {
              // Successfully navigated to the next page
              return true
            }

            await delay(10)
          }

          return false
        })(),

        delay(navigationTimeout, { signal })
      ])

      if (navigatedToNextPage) {
        break
      }

      if (++retries >= 30) {
        console.warn('unable to navigate to next page; breaking...', pageNav)
        done = true
        break
      }
    } while (true)
  } while (!done)

  await writeResultMetadata()
  reporter.emit({ event: 'step-done', step: 'extract' })
  reporter.emit({ event: 'done', outFile: metadataPath })

  // Put the reader back where it was, in whichever unit this book uses.
  const initialNavValue = navUnitValue(initialPageNav)
  if (initialNavValue !== undefined) {
    reporter.log(
      `resetting back to initial ${result.nav.unit} ${initialNavValue}...`
    )
    await goToPage(initialNavValue)
  }

  await context.close()
  await context.browser()?.close()
}

await main()
