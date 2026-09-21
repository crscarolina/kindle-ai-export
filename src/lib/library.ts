import { normalizeAuthors } from '../utils'
import { parseAsin } from './asin'

/** A book in the reader's Kindle library, as the picker shows it. */
export type LibraryItem = {
  asin: string
  title: string
  authors: string[]
  coverUrl: string | undefined
}

/**
 * Normalise a `/kindle-library/search` response.
 *
 * Amazon's payload is undocumented and carries far more than the picker
 * needs, so this is deliberately tolerant: anything without a usable ASIN is
 * dropped, and every other field degrades to a sensible default rather than
 * failing the whole listing.
 */
export function normalizeLibraryItems(response: unknown): LibraryItem[] {
  if (!response || typeof response !== 'object') {
    return []
  }

  const { itemsList } = response as { itemsList?: unknown }
  if (!Array.isArray(itemsList)) {
    return []
  }

  const seen = new Set<string>()
  const items: LibraryItem[] = []

  for (const raw of itemsList) {
    if (!raw || typeof raw !== 'object') continue

    const item = raw as Record<string, unknown>
    const asin =
      typeof item.asin === 'string' ? parseAsin(item.asin) : undefined
    if (!asin || seen.has(asin)) continue
    seen.add(asin)

    const cover = item.productUrl ?? item.productImage
    items.push({
      asin,
      title: typeof item.title === 'string' && item.title ? item.title : asin,
      authors: normalizeAuthors(
        Array.isArray(item.authors) ? (item.authors as string[]) : []
      ),
      coverUrl: typeof cover === 'string' ? cover : undefined
    })
  }

  return items
}

/**
 * Amazon caps a library page at 50 regardless of the requested size, and
 * returns a `paginationToken` for the next one.
 */
export const LIBRARY_PAGE_SIZE = 50

/** Build one page of the library search request. */
export function buildLibrarySearchUrl({
  query = '',
  querySize = LIBRARY_PAGE_SIZE,
  sortType = 'recency',
  paginationToken
}: {
  query?: string
  querySize?: number
  sortType?: string
  paginationToken?: string
}): string {
  const params = new URLSearchParams({
    query,
    libraryType: 'BOOKS',
    sortType,
    querySize: String(querySize)
  })

  if (paginationToken) {
    params.set('paginationToken', paginationToken)
  }

  return `/kindle-library/search?${params}`
}

/**
 * Flatten every page into one library, keeping order.
 *
 * Pages overlap -- a 234-book library came back as 245 items across five
 * requests -- so the first sighting of a book wins and later repeats are
 * dropped.
 */
export function mergeLibraryPages(responses: unknown[]): LibraryItem[] {
  const seen = new Set<string>()
  const merged: LibraryItem[] = []

  for (const response of responses) {
    for (const item of normalizeLibraryItems(response)) {
      if (seen.has(item.asin)) continue
      seen.add(item.asin)
      merged.push(item)
    }
  }

  return merged
}

/**
 * How many pages to request before treating pagination as runaway.
 *
 * Amazon's `paginationToken` is opaque, so the only defence against a token
 * that never terminates is a ceiling. 200 pages is 10,000 books -- far past
 * any real library, but small enough that a broken response ends in seconds
 * rather than never.
 */
export const LIBRARY_MAX_PAGES = 200

/** How long one page request may take before it is abandoned. */
export const LIBRARY_PAGE_TIMEOUT_MS = 20_000

/** How many times a failed or stalled page request is tried again. */
export const LIBRARY_PAGE_RETRIES = 2

/** Why paging stopped. */
export type LibraryPagingStop =
  /** Amazon returned no token: the library ended here. */
  | 'complete'
  /** An under-full page, which Amazon only sends for the last one. */
  | 'short-page'
  /** The caller asked for fewer books than have already been fetched. */
  | 'limit'
  /** The token didn't advance, so the next request would repeat this page. */
  | 'repeated-token'
  /** The page ceiling was hit. */
  | 'max-pages'

export type LibraryPagingDecision =
  | { done: false; paginationToken: string }
  | { done: true; reason: LibraryPagingStop }

/**
 * Decide whether to ask for another page, given the one that just arrived.
 *
 * Kept separate from the request itself because every way this loop can fail
 * to terminate lives here: a token that repeats, a token that never clears,
 * a page count that never reaches the end.
 */
export function nextLibraryPage({
  response,
  seenTokens,
  pagesFetched,
  limit,
  maxPages = LIBRARY_MAX_PAGES
}: {
  response: unknown
  /** Every token already requested, including the one that produced this page. */
  seenTokens: ReadonlySet<string>
  pagesFetched: number
  limit?: number | undefined
  maxPages?: number
}): LibraryPagingDecision {
  const body = (response ?? {}) as {
    itemsList?: unknown
    paginationToken?: unknown
  }
  const count = Array.isArray(body.itemsList) ? body.itemsList.length : 0
  const token =
    typeof body.paginationToken === 'string' && body.paginationToken
      ? body.paginationToken
      : undefined

  if (!token) {
    return { done: true, reason: 'complete' }
  }

  if (seenTokens.has(token)) {
    return { done: true, reason: 'repeated-token' }
  }

  if (count < LIBRARY_PAGE_SIZE) {
    return { done: true, reason: 'short-page' }
  }

  if (limit && pagesFetched * LIBRARY_PAGE_SIZE >= limit) {
    return { done: true, reason: 'limit' }
  }

  if (pagesFetched >= maxPages) {
    return { done: true, reason: 'max-pages' }
  }

  return { done: false, paginationToken: token }
}

/** Fetches one library page. Injected so the loop can be tested without a browser. */
export type LibraryPageFetcher = (
  url: string,
  options: { timeoutMs: number }
) => Promise<unknown>

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Bound a request that may never settle.
 *
 * A `fetch` driven from inside the browser has no timeout of its own, and
 * neither does Playwright's `evaluate`, so a stalled request otherwise hangs
 * the whole listing with no output at all.
 */
async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  // The abandoned request can still reject long after the race is over.
  work.catch(() => {})

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms
        )
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Walk the library one page at a time, following Amazon's pagination token.
 *
 * Every stopping condition is bounded: a request that stalls is abandoned and
 * retried, a token that stops advancing ends the walk, and the page count is
 * capped. Whatever pages did arrive are returned, so a library that ends
 * early is still a library rather than a failure.
 */
export async function collectLibraryPages({
  fetchPage,
  limit,
  maxPages = LIBRARY_MAX_PAGES,
  timeoutMs = LIBRARY_PAGE_TIMEOUT_MS,
  retries = LIBRARY_PAGE_RETRIES,
  retryDelayMs = 1000,
  // Amazon's library endpoint is undocumented and unthrottled bursts are the
  // kind of thing it rate-limits, so pages are spaced out slightly.
  pageDelayMs = 250,
  onPage,
  onWarning
}: {
  fetchPage: LibraryPageFetcher
  limit?: number | undefined
  maxPages?: number
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
  pageDelayMs?: number
  onPage?: (info: {
    page: number
    count: number
    fetched: number
    hasMore: boolean
  }) => void
  onWarning?: (message: string) => void
}): Promise<unknown[]> {
  const responses: unknown[] = []
  const seenTokens = new Set<string>()
  let paginationToken: string | undefined
  let fetched = 0

  for (;;) {
    const url = buildLibrarySearchUrl({ paginationToken })
    const pageNumber = responses.length + 1
    let response: unknown
    let lastError: unknown

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0 && retryDelayMs) {
        await sleep(retryDelayMs)
      }

      try {
        response = await withTimeout(
          fetchPage(url, { timeoutMs }),
          timeoutMs,
          `library page ${pageNumber}`
        )
        lastError = undefined
        break
      } catch (err: any) {
        lastError = err
        onWarning?.(
          `library page ${pageNumber} failed (attempt ${attempt + 1}/${retries + 1}): ${err?.message ?? err}`
        )
      }
    }

    if (lastError) {
      throw new Error(
        `Could not fetch library page ${pageNumber} after ${retries + 1} attempts: ${(lastError as any)?.message ?? lastError}`,
        { cause: lastError }
      )
    }

    responses.push(response)
    const count = Array.isArray((response as any)?.itemsList)
      ? (response as any).itemsList.length
      : 0
    fetched += count

    const decision = nextLibraryPage({
      response,
      seenTokens,
      pagesFetched: responses.length,
      limit,
      maxPages
    })

    onPage?.({ page: pageNumber, count, fetched, hasMore: !decision.done })

    if (decision.done) {
      if (decision.reason === 'repeated-token') {
        onWarning?.(
          `Amazon stopped advancing its pagination token after ${responses.length} pages; stopping with ${fetched} books`
        )
      } else if (decision.reason === 'max-pages') {
        onWarning?.(
          `stopped after ${maxPages} pages without reaching the end of the library`
        )
      }

      return responses
    }

    paginationToken = decision.paginationToken
    seenTokens.add(paginationToken)

    if (pageDelayMs) {
      await sleep(pageDelayMs)
    }
  }
}
