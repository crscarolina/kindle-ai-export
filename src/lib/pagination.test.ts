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

  test('describes an unpaginated book', () => {
    expect(describePagination(0)).toBe('no page numbers')
  })

  test('describes an unknown result', () => {
    expect(describePagination(null)).toBe('unknown')
  })

  test('uses the singular for one page', () => {
    expect(describePagination(1)).toBe('1 page')
  })
})
