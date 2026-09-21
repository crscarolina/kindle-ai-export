import { describe, expect, test } from 'vitest'

import { normalizeLibraryItems } from './library'

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
