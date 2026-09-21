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
