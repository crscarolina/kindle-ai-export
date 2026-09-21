import { describe, expect, test } from 'vitest'

import { parseAsin } from './asin'

describe('parseAsin', () => {
  test('accepts a bare ASIN', () => {
    expect(parseAsin('B0819W19WD')).toBe('B0819W19WD')
  })

  test('upper-cases a lowercase ASIN', () => {
    expect(parseAsin('b0819w19wd')).toBe('B0819W19WD')
  })

  test('trims surrounding whitespace', () => {
    expect(parseAsin('  B0819W19WD \n')).toBe('B0819W19WD')
  })

  test('extracts the asin query param from a Kindle reader URL', () => {
    expect(
      parseAsin('https://read.amazon.com/?asin=B0819W19WD&ref_=kwl_kr_iv_rec_2')
    ).toBe('B0819W19WD')
  })

  test('extracts from a reader URL with a path', () => {
    expect(parseAsin('https://read.amazon.com/reader?asin=B0819W19WD')).toBe(
      'B0819W19WD'
    )
  })

  test('is case-insensitive about the query param name', () => {
    expect(parseAsin('https://read.amazon.com/?ASIN=B0819W19WD')).toBe(
      'B0819W19WD'
    )
  })

  test('extracts from an amazon.com product URL', () => {
    expect(
      parseAsin('https://www.amazon.com/gp/product/B0819W19WD?ref_=dbs_m_mng')
    ).toBe('B0819W19WD')
  })

  test('extracts from an amazon.com /dp/ URL', () => {
    expect(parseAsin('https://www.amazon.co.uk/dp/B0819W19WD')).toBe(
      'B0819W19WD'
    )
  })

  test('prefers the asin query param over a path segment', () => {
    expect(
      parseAsin('https://read.amazon.com/dp/B000000000?asin=B0819W19WD')
    ).toBe('B0819W19WD')
  })

  test('rejects an empty string', () => {
    expect(parseAsin('')).toBeUndefined()
  })

  test('rejects a too-short identifier', () => {
    expect(parseAsin('B0819W19')).toBeUndefined()
  })

  test('rejects a too-long identifier', () => {
    expect(parseAsin('B0819W19WDXX')).toBeUndefined()
  })

  test('rejects an identifier with punctuation', () => {
    expect(parseAsin('B0819-19WD')).toBeUndefined()
  })

  test('rejects a URL with no recognisable ASIN', () => {
    expect(parseAsin('https://read.amazon.com/kindle-library')).toBeUndefined()
  })

  test('does not mistake a long path segment for an ASIN', () => {
    expect(
      parseAsin('https://www.amazon.com/some-very-long-book-title/dp')
    ).toBeUndefined()
  })
})
