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
