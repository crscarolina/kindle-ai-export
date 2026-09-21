import { describe, expect, test } from 'vitest'

import {
  buildLibrarySearchUrl,
  collectLibraryPages,
  LIBRARY_PAGE_SIZE,
  mergeLibraryPages,
  nextLibraryPage,
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

/** A page of `asins`, with Amazon's token for the next one when there is one. */
function searchPage(asins: string[], paginationToken?: string) {
  return {
    itemsList: asins.map((asin) => ({ asin })),
    ...(paginationToken ? { paginationToken } : {})
  }
}

/** A page at Amazon's cap, which is what a page before the last looks like. */
function fullSearchPage(paginationToken?: string) {
  return searchPage(
    Array.from(
      { length: LIBRARY_PAGE_SIZE },
      (_, i) => `B${String(i).padStart(9, '0')}`
    ),
    paginationToken
  )
}

function decide(response: unknown, overrides: Record<string, any> = {}) {
  return nextLibraryPage({
    response,
    seenTokens: new Set<string>(),
    pagesFetched: 1,
    ...overrides
  })
}

describe('nextLibraryPage', () => {
  test('follows the token when a full page has one', () => {
    expect(decide(fullSearchPage('91'))).toEqual({
      done: false,
      paginationToken: '91'
    })
  })

  test('stops when the last page has no token', () => {
    expect(decide(fullSearchPage())).toEqual({ done: true, reason: 'complete' })
  })

  test('stops when the token is empty', () => {
    expect(decide({ ...fullSearchPage(), paginationToken: '' })).toEqual({
      done: true,
      reason: 'complete'
    })
  })

  test('stops when the token is not a string', () => {
    expect(decide({ ...fullSearchPage(), paginationToken: 41 })).toEqual({
      done: true,
      reason: 'complete'
    })
  })

  test('stops when the token repeats the one just used', () => {
    expect(
      decide(fullSearchPage('41'), { seenTokens: new Set(['41']) })
    ).toEqual({
      done: true,
      reason: 'repeated-token'
    })
  })

  test('stops when the token was seen on an earlier page', () => {
    expect(
      decide(fullSearchPage('41'), { seenTokens: new Set(['41', '91', '141']) })
    ).toEqual({ done: true, reason: 'repeated-token' })
  })

  test('stops on a short page even when a token came back', () => {
    expect(decide({ itemsList: [{ asin: 'B000000001' }] })).toEqual({
      done: true,
      reason: 'complete'
    })
    expect(
      decide({ itemsList: [{ asin: 'B000000001' }], paginationToken: '91' })
    ).toEqual({ done: true, reason: 'short-page' })
  })

  test('stops once the requested limit is covered', () => {
    expect(
      decide(fullSearchPage('91'), { pagesFetched: 2, limit: 100 })
    ).toEqual({
      done: true,
      reason: 'limit'
    })
  })

  test('keeps going while the limit is not yet covered', () => {
    expect(
      decide(fullSearchPage('91'), { pagesFetched: 1, limit: 100 })
    ).toEqual({
      done: false,
      paginationToken: '91'
    })
  })

  test('stops at the page cap', () => {
    expect(
      decide(fullSearchPage('91'), { pagesFetched: 3, maxPages: 3 })
    ).toEqual({
      done: true,
      reason: 'max-pages'
    })
  })

  test('stops on a response that is not a library page at all', () => {
    expect(decide(null)).toEqual({ done: true, reason: 'complete' })
    expect(decide('nope')).toEqual({ done: true, reason: 'complete' })
  })
})

describe('collectLibraryPages', () => {
  const fast = { pageDelayMs: 0, retryDelayMs: 0, timeoutMs: 50 }

  test('follows tokens until the library runs out', async () => {
    const urls: string[] = []
    const responses = [
      fullSearchPage('41'),
      fullSearchPage('91'),
      searchPage(['B000000001'])
    ]

    const pages = await collectLibraryPages({
      ...fast,
      fetchPage: async (url) => {
        urls.push(url)
        return responses[urls.length - 1]
      }
    })

    expect(pages).toHaveLength(3)
    expect(urls[0]).not.toContain('paginationToken')
    expect(urls[1]).toContain('paginationToken=41')
    expect(urls[2]).toContain('paginationToken=91')
  })

  test('reports each page as it arrives', async () => {
    const seen: unknown[] = []
    await collectLibraryPages({
      ...fast,
      fetchPage: async (_url) =>
        seen.length === 0 ? fullSearchPage('41') : searchPage(['B000000001']),
      onPage: (info) => seen.push(info)
    })

    expect(seen).toEqual([
      {
        page: 1,
        count: LIBRARY_PAGE_SIZE,
        fetched: LIBRARY_PAGE_SIZE,
        hasMore: true
      },
      {
        page: 2,
        count: 1,
        fetched: LIBRARY_PAGE_SIZE + 1,
        hasMore: false
      }
    ])
  })

  test('gives up when a request never settles', async () => {
    // The bug this guards: an in-page fetch that never resolves used to hang
    // the whole listing with no further output.
    await expect(
      collectLibraryPages({
        ...fast,
        retries: 0,
        fetchPage: () => new Promise(() => {})
      })
    ).rejects.toThrow(/timed out/i)
  })

  test('retries a failed request before giving up', async () => {
    let attempts = 0
    const pages = await collectLibraryPages({
      ...fast,
      fetchPage: async () => {
        attempts++
        if (attempts < 3) throw new Error('HTTP 503')
        return searchPage(['B000000001'])
      }
    })

    expect(attempts).toBe(3)
    expect(pages).toHaveLength(1)
  })

  test('throws with the underlying cause once retries run out', async () => {
    await expect(
      collectLibraryPages({
        ...fast,
        retries: 1,
        fetchPage: async () => {
          throw new Error('HTTP 503')
        }
      })
    ).rejects.toThrow(/HTTP 503/)
  })

  test('warns on every failed attempt', async () => {
    const warnings: string[] = []
    await collectLibraryPages({
      ...fast,
      fetchPage: async () => {
        if (warnings.length === 0) throw new Error('HTTP 503')
        return searchPage(['B000000001'])
      },
      onWarning: (message) => warnings.push(message)
    })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('HTTP 503')
  })

  test('stops and warns when the token stops advancing', async () => {
    const warnings: string[] = []
    const pages = await collectLibraryPages({
      ...fast,
      fetchPage: async () => fullSearchPage('41'),
      onWarning: (message) => warnings.push(message)
    })

    expect(pages).toHaveLength(2)
    expect(warnings.join(' ')).toMatch(/token/i)
  })

  test('stops and warns at the page cap', async () => {
    const warnings: string[] = []
    let n = 0
    const pages = await collectLibraryPages({
      ...fast,
      maxPages: 3,
      fetchPage: async () => fullSearchPage(String(++n)),
      onWarning: (message) => warnings.push(message)
    })

    expect(pages).toHaveLength(3)
    expect(warnings.join(' ')).toMatch(/3 pages/)
  })

  test('stops once the limit is covered', async () => {
    let n = 0
    const pages = await collectLibraryPages({
      ...fast,
      limit: 60,
      fetchPage: async () => fullSearchPage(String(++n))
    })

    expect(pages).toHaveLength(2)
  })
})
