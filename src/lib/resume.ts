/** A page screenshot that has already been captured. */
export type CapturedPage = {
  /** Sequential screenshot counter. Unique per screenshot. */
  index: number
  /** Kindle page number. Not unique -- one page can span several screenshots. */
  page: number
}

/** Where a resumed extraction should pick up. */
export type ResumePoint = {
  /** The first index that still needs capturing. */
  index: number
  /** The page the last captured screenshot was on, if any. */
  page: number | undefined
}

const PAGE_SCREENSHOT_REGEX = /(?:^|\/)(\d+)-(\d+)\.png$/

/**
 * Parse an `${index}-${page}.png` screenshot filename, with or without a
 * leading directory. Returns `undefined` for anything else in the directory.
 */
export function parsePageScreenshotName(
  filename: string
): CapturedPage | undefined {
  const match = filename?.match(PAGE_SCREENSHOT_REGEX)
  if (!match) {
    return
  }

  return { index: Number(match[1]), page: Number(match[2]) }
}

/** Parse every page screenshot in a directory listing, sorted by index. */
export function scanCompletedPages(filenames: string[]): CapturedPage[] {
  return filenames
    .map((filename) => parsePageScreenshotName(filename))
    .filter((page): page is CapturedPage => !!page)
    .toSorted((a, b) => a.index - b.index)
}

/**
 * Find the first index that still needs capturing.
 *
 * Only a *contiguous* run counts as done: resuming past a gap would silently
 * drop the missing pages from the finished book, and the failure would show
 * up as a plausible-looking export rather than an error.
 */
export function findResumePoint(captured: CapturedPage[]): ResumePoint {
  const byIndex = new Map(captured.map((page) => [page.index, page]))

  let next = 0
  let last: CapturedPage | undefined

  for (;;) {
    const page = byIndex.get(next)
    if (!page) {
      break
    }

    last = page
    next++
  }

  return { index: next, page: last?.page }
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
])
const PNG_IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44])

/**
 * Check that a buffer is a complete PNG -- correct signature and a terminating
 * IEND chunk.
 *
 * A crash part-way through a write leaves a file that exists and looks
 * captured but can't be decoded, so resume must not trust mere existence.
 */
export function isCompletePng(buf: Buffer): boolean {
  if (buf.length < PNG_SIGNATURE.length + PNG_IEND.length) {
    return false
  }

  if (!buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return false
  }

  // IEND is the final chunk; allow for its 4-byte CRC trailer.
  return buf.subarray(-12).includes(PNG_IEND)
}

/** How to restart an interrupted extraction. */
export type ExtractionResumePlan = {
  /** The page to navigate back to, or `undefined` to start from the top. */
  resumePage: number | undefined
  /** Captured pages to keep; the rest are re-captured. */
  keep: CapturedPage[]
}

/**
 * Plan a resumed extraction from what is already on disk.
 *
 * A Kindle page can span several screenshots, so an interrupted run may have
 * captured only part of its final page. Resuming mid-page would duplicate or
 * drop content, so the last page is discarded and re-captured whole.
 */
export function planExtractionResume(
  captured: CapturedPage[]
): ExtractionResumePlan {
  const contiguous = scanCompletedPages(
    captured.map(({ index, page }) => `${index}-${page}.png`)
  ).slice(0, findResumePoint(captured).index)

  const lastPage = contiguous.at(-1)?.page
  if (lastPage === undefined) {
    return { resumePage: undefined, keep: [] }
  }

  const keep = contiguous.filter((page) => page.page !== lastPage)

  // Nothing survives, so there is no partial run worth resuming.
  return keep.length
    ? { resumePage: lastPage, keep }
    : { resumePage: undefined, keep: [] }
}
