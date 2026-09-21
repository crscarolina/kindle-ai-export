import type { AmazonRenderLocationMap } from '../types'

/** How a book numbers itself. */
export type NavUnit = 'page' | 'location'

export type BookIndex = {
  unit: NavUnit
  /** The highest unit number in the book. */
  total: number
  /** The unit number containing a position. */
  unitForPosition: (position: number) => number
}

/**
 * Decide how to index a book, and map positions onto that index.
 *
 * Most titles carry a `navigationUnit` mapping positions to print-edition
 * page numbers. Amazon omits it for editions with no print counterpart --
 * public-domain reissues and many indie titles -- leaving only the `locations`
 * array. Those books are indexed by Kindle location instead, which is the same
 * shape of problem: a sorted list of start positions.
 */
export function createBookIndex(
  locationMap: AmazonRenderLocationMap
): BookIndex {
  const navigationUnit = locationMap?.navigationUnit
  if (Array.isArray(navigationUnit) && navigationUnit.length) {
    const starts = navigationUnit.map((unit) => unit.startPosition)

    return {
      unit: 'page',
      total: navigationUnit.reduce((max, unit) => Math.max(max, unit.page), 0),
      unitForPosition: (position) =>
        navigationUnit[firstOfRun(starts, position)]!.page
    }
  }

  const locations = locationMap?.locations
  if (Array.isArray(locations) && locations.length) {
    return {
      unit: 'location',
      total: locations.length,
      // Kindle numbers locations from one, while the array is zero-based.
      unitForPosition: (position) => firstOfRun(locations, position) + 1
    }
  }

  throw new Error(
    'location map has no pagination: neither navigationUnit nor locations'
  )
}

/**
 * Index of the entry covering `position`.
 *
 * Start positions repeat -- a book's opening locations all begin at the same
 * position -- so a run of equal values resolves to the first of them, which
 * is the one a reader would be shown.
 */
function firstOfRun(starts: number[], position: number): number {
  let low = 0
  let high = starts.length

  // First index whose start is greater than the position.
  while (low < high) {
    const mid = (low + high) >> 1
    if (starts[mid]! <= position) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  let index = Math.max(0, low - 1)
  while (index > 0 && starts[index - 1] === starts[index]) {
    index--
  }

  return index
}
