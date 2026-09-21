import { describe, expect, test } from 'vitest'

import {
  buildLibrarySearchUrl,
  mergeLibraryPages,
  normalizeLibraryItems
} from './library'

describe('normalizeLibraryItems', () => {
  test('maps a library search response to library items', () => {
    expect(
      normalizeLibraryItems({
        itemsList: [
          {
            asin: 'B0819W19WD',
            title: 'Revelation Space',
            authors: ['Reynolds, Alastair:'],
            productUrl: 'https://m.media-amazon.com/images/I/cover.jpg'
          }
        ]
      })
    ).toEqual([
      {
        asin: 'B0819W19WD',
        title: 'Revelation Space',
        authors: ['Alastair Reynolds'],
        coverUrl: 'https://m.media-amazon.com/images/I/cover.jpg'
      }
    ])
  })

  test('normalises Amazon’s reversed author format', () => {
    const [item] = normalizeLibraryItems({
      itemsList: [
        { asin: 'B0819W19WD', title: 'X', authors: ['Marillier, Juliet:'] }
      ]
    })
    expect(item!.authors).toEqual(['Juliet Marillier'])
  })

  test('falls back to productImage for the cover', () => {
    const [item] = normalizeLibraryItems({
      itemsList: [
        { asin: 'B0819W19WD', title: 'X', productImage: 'https://img/x.jpg' }
      ]
    })
    expect(item!.coverUrl).toBe('https://img/x.jpg')
  })

  test('leaves the cover undefined when absent', () => {
    const [item] = normalizeLibraryItems({
      itemsList: [{ asin: 'B0819W19WD', title: 'X' }]
    })
    expect(item!.coverUrl).toBeUndefined()
  })

  test('defaults a missing title to the asin so the row is still usable', () => {
    const [item] = normalizeLibraryItems({
      itemsList: [{ asin: 'B0819W19WD' }]
    })
    expect(item!.title).toBe('B0819W19WD')
  })

  test('defaults missing authors to an empty list', () => {
    const [item] = normalizeLibraryItems({
      itemsList: [{ asin: 'B0819W19WD', title: 'X' }]
    })
    expect(item!.authors).toEqual([])
  })

  test('drops entries without a valid asin', () => {
    expect(
      normalizeLibraryItems({
        itemsList: [{ title: 'No asin' }, { asin: 'nope', title: 'Bad asin' }]
      })
    ).toEqual([])
  })

  test('returns an empty list when itemsList is missing', () => {
    expect(normalizeLibraryItems({})).toEqual([])
  })

  test('returns an empty list when itemsList is not an array', () => {
    expect(normalizeLibraryItems({ itemsList: 'nope' })).toEqual([])
  })

  test('returns an empty list for a null response', () => {
    expect(normalizeLibraryItems(null)).toEqual([])
  })

  test('returns an empty list for a non-object response', () => {
    expect(normalizeLibraryItems('nope')).toEqual([])
  })

  test('de-duplicates repeated asins', () => {
    expect(
      normalizeLibraryItems({
        itemsList: [
          { asin: 'B0819W19WD', title: 'First' },
          { asin: 'B0819W19WD', title: 'Duplicate' }
        ]
      })
    ).toHaveLength(1)
  })
})

describe('buildLibrarySearchUrl', () => {
  test('builds a first-page request', () => {
    const url = buildLibrarySearchUrl({})
    expect(url).toContain('/kindle-library/search')
    expect(url).toContain('libraryType=BOOKS')
    expect(url).toContain('sortType=recency')
  })

  test('omits the pagination token on the first page', () => {
    expect(buildLibrarySearchUrl({})).not.toContain('paginationToken')
  })

  test('includes the pagination token on later pages', () => {
    expect(buildLibrarySearchUrl({ paginationToken: '41' })).toContain(
      'paginationToken=41'
    )
  })

  test('escapes a token containing url syntax', () => {
    expect(buildLibrarySearchUrl({ paginationToken: 'a&b=c' })).toContain(
      'paginationToken=a%26b%3Dc'
    )
  })

  test('carries a search query through', () => {
    expect(buildLibrarySearchUrl({ query: 'dune' })).toContain('query=dune')
  })
})

describe('mergeLibraryPages', () => {
  const pageOne = {
    itemsList: [
      { asin: 'B000000001', title: 'One' },
      { asin: 'B000000002', title: 'Two' }
    ]
  }
  const pageTwo = {
    itemsList: [
      { asin: 'B000000003', title: 'Three' },
      { asin: 'B000000004', title: 'Four' }
    ]
  }

  test('concatenates pages in order', () => {
    expect(
      mergeLibraryPages([pageOne, pageTwo]).map((item) => item.title)
    ).toEqual(['One', 'Two', 'Three', 'Four'])
  })

  test('de-duplicates across page boundaries', () => {
    // Amazon repeats items between pages; 245 responses held 234 books.
    const overlapping = {
      itemsList: [
        { asin: 'B000000002', title: 'Two again' },
        { asin: 'B000000003', title: 'Three' }
      ]
    }
    const merged = mergeLibraryPages([pageOne, overlapping])
    expect(merged).toHaveLength(3)
    expect(merged.map((item) => item.asin)).toEqual([
      'B000000001',
      'B000000002',
      'B000000003'
    ])
  })

  test('keeps the first occurrence of a repeated book', () => {
    const merged = mergeLibraryPages([
      pageOne,
      { itemsList: [{ asin: 'B000000001', title: 'Renamed' }] }
    ])
    expect(merged[0]!.title).toBe('One')
  })

  test('skips pages with no items', () => {
    expect(mergeLibraryPages([pageOne, {}, pageTwo])).toHaveLength(4)
  })

  test('returns nothing for no pages', () => {
    expect(mergeLibraryPages([])).toEqual([])
  })
})
