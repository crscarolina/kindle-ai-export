import { describe, expect, test } from 'vitest'

import { countNavigationUnits, describePagination } from './pagination'

describe('countNavigationUnits', () => {
  test('counts a populated navigation unit', () => {
    expect(
      countNavigationUnits({ locations: [1, 2], navigationUnit: [{}, {}, {}] })
    ).toBe(3)
  })

  test('reports zero when navigationUnit is absent', () => {
    // Amazon omits it entirely for titles with no print-edition pagination.
    expect(countNavigationUnits({ locations: [1, 2, 3] })).toBe(0)
  })

  test('reports zero for an empty navigationUnit', () => {
    expect(countNavigationUnits({ navigationUnit: [] })).toBe(0)
  })

  test('reports zero when navigationUnit is not an array', () => {
    expect(countNavigationUnits({ navigationUnit: 'nope' })).toBe(0)
  })

  test('returns null when there is no location map at all', () => {
    // Unknown is not the same as unpaginated, and must not be reported as one.
    expect(countNavigationUnits(undefined)).toBeNull()
    expect(countNavigationUnits(null)).toBeNull()
  })

  test('returns null for a non-object', () => {
    expect(countNavigationUnits('nope')).toBeNull()
  })
})

describe('describePagination', () => {
  test('describes a paginated book', () => {
    expect(describePagination(664)).toBe('664 pages')
  })

  test('describes a book indexed by location', () => {
    // Exportable, just numbered differently -- not a dead end.
    expect(describePagination(0)).toBe('by location')
  })

  test('distinguishes a timeout from a verdict', () => {
    expect(describePagination(null)).toBe('timed out')
  })

  test('uses the singular for one page', () => {
    expect(describePagination(1)).toBe('1 page')
  })
})
