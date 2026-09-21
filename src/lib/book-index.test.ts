import { describe, expect, test } from 'vitest'

import type { AmazonRenderLocationMap } from '../types'
import { navUnitValue } from '../playwright-utils'
import { createBookIndex } from './book-index'

const paged = {
  locations: [2, 2, 67, 146, 289, 360],
  navigationUnit: [
    { startPosition: 100, page: 1, label: '1' },
    { startPosition: 200, page: 2, label: '2' },
    { startPosition: 300, page: 3, label: '3' }
  ]
} as AmazonRenderLocationMap

const unpaged = {
  locations: [2, 2, 2, 2, 67, 146, 289, 360]
} as AmazonRenderLocationMap

describe('createBookIndex, paged book', () => {
  const index = createBookIndex(paged)

  test('indexes by page when a navigation unit is present', () => {
    expect(index.unit).toBe('page')
  })

  test('reports the highest page as the total', () => {
    expect(index.total).toBe(3)
  })

  test('maps a position inside a page to that page', () => {
    expect(index.unitForPosition(250)).toBe(2)
  })

  test('maps a position exactly on a boundary to the page it starts', () => {
    expect(index.unitForPosition(200)).toBe(2)
  })

  test('maps a position past the last boundary to the last page', () => {
    expect(index.unitForPosition(99_999)).toBe(3)
  })

  test('maps a position before the first boundary to page 1', () => {
    // Front matter sits before the first numbered page.
    expect(index.unitForPosition(1)).toBe(1)
  })
})

describe('createBookIndex, unpaged book', () => {
  const index = createBookIndex(unpaged)

  test('falls back to locations when there is no navigation unit', () => {
    expect(index.unit).toBe('location')
  })

  test('reports the number of locations as the total', () => {
    expect(index.total).toBe(8)
  })

  test('numbers locations from one', () => {
    expect(index.unitForPosition(2)).toBe(1)
  })

  test('resolves a run of identical start positions to the first of them', () => {
    // The opening locations all start at the same position; the first one is
    // the answer, not the last.
    expect(index.unitForPosition(2)).toBe(1)
  })

  test('maps a position inside a location to that location', () => {
    expect(index.unitForPosition(200)).toBe(6)
  })

  test('maps a position exactly on a boundary to the location it starts', () => {
    expect(index.unitForPosition(146)).toBe(6)
  })

  test('maps a position past the end to the last location', () => {
    expect(index.unitForPosition(99_999)).toBe(8)
  })

  test('maps a position before the first location to location 1', () => {
    expect(index.unitForPosition(0)).toBe(1)
  })

  test('is monotonic across the whole book', () => {
    let previous = 0
    for (let position = 0; position < 400; position += 7) {
      const unit = index.unitForPosition(position)
      expect(unit).toBeGreaterThanOrEqual(previous)
      previous = unit
    }
  })
})

describe('createBookIndex, unusable maps', () => {
  test('prefers pages when both are present', () => {
    expect(createBookIndex(paged).unit).toBe('page')
  })

  test('treats an empty navigation unit as unpaged', () => {
    expect(
      createBookIndex({
        locations: [1, 2, 3],
        navigationUnit: []
      } as unknown as AmazonRenderLocationMap).unit
    ).toBe('location')
  })

  test('throws when there is neither pagination nor locations', () => {
    expect(() => createBookIndex({} as AmazonRenderLocationMap)).toThrow(
      /no pagination/i
    )
  })

  test('throws for an empty locations array', () => {
    expect(() =>
      createBookIndex({ locations: [] } as unknown as AmazonRenderLocationMap)
    ).toThrow(/no pagination/i)
  })
})

describe('navUnitValue', () => {
  test('reads a page number', () => {
    expect(navUnitValue({ page: 12, total: 400 })).toBe(12)
  })

  test('reads a location when there is no page', () => {
    expect(navUnitValue({ location: 340, total: 7005 })).toBe(340)
  })

  test('prefers the page when both are present', () => {
    expect(navUnitValue({ page: 12, location: 340, total: 400 })).toBe(12)
  })

  test('returns undefined when the nav could not be parsed', () => {
    expect(navUnitValue(undefined)).toBeUndefined()
  })

  test('returns undefined when neither is present', () => {
    expect(navUnitValue({ total: 400 } as never)).toBeUndefined()
  })

  test('treats location zero as a value, not as missing', () => {
    expect(navUnitValue({ location: 0, total: 10 })).toBe(0)
  })
})
