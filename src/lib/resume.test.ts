import { describe, expect, test } from 'vitest'

import {
  findResumePoint,
  isCompletePng,
  parsePageScreenshotName,
  planExtractionResume,
  scanCompletedPages
} from './resume'

describe('parsePageScreenshotName', () => {
  test('parses a zero-padded index/page pair', () => {
    expect(parsePageScreenshotName('0000-0001.png')).toEqual({
      index: 0,
      page: 1
    })
  })

  test('parses larger values', () => {
    expect(parsePageScreenshotName('0740-0652.png')).toEqual({
      index: 740,
      page: 652
    })
  })

  test('strips a leading directory', () => {
    expect(parsePageScreenshotName('out/B0/pages/0012-0009.png')).toEqual({
      index: 12,
      page: 9
    })
  })

  test('rejects a non-screenshot file', () => {
    expect(parsePageScreenshotName('metadata.json')).toBeUndefined()
  })

  test('rejects a malformed name', () => {
    expect(parsePageScreenshotName('0000.png')).toBeUndefined()
  })

  test('rejects a non-png extension', () => {
    expect(parsePageScreenshotName('0000-0001.jpg')).toBeUndefined()
  })

  test('rejects non-numeric segments', () => {
    expect(parsePageScreenshotName('000a-0001.png')).toBeUndefined()
  })
})

describe('scanCompletedPages', () => {
  test('returns entries sorted by index', () => {
    expect(
      scanCompletedPages(['0002-0002.png', '0000-0001.png', '0001-0001.png'])
    ).toEqual([
      { index: 0, page: 1 },
      { index: 1, page: 1 },
      { index: 2, page: 2 }
    ])
  })

  test('ignores files that are not page screenshots', () => {
    expect(
      scanCompletedPages(['.DS_Store', 'metadata.json', '0000-0001.png'])
    ).toEqual([{ index: 0, page: 1 }])
  })

  test('preserves repeated page numbers across distinct indices', () => {
    // Kindle renders more than one screenshot for the same page number, so
    // index -> page is many-to-one and resume must key on index.
    expect(scanCompletedPages(['0000-0001.png', '0001-0001.png'])).toEqual([
      { index: 0, page: 1 },
      { index: 1, page: 1 }
    ])
  })

  test('returns an empty array for an empty directory', () => {
    expect(scanCompletedPages([])).toEqual([])
  })
})

describe('findResumePoint', () => {
  test('starts from scratch when nothing has been captured', () => {
    expect(findResumePoint([])).toEqual({ index: 0, page: undefined })
  })

  test('resumes after a fully contiguous run', () => {
    expect(
      findResumePoint([
        { index: 0, page: 1 },
        { index: 1, page: 1 },
        { index: 2, page: 2 }
      ])
    ).toEqual({ index: 3, page: 2 })
  })

  test('stops at the first gap rather than skipping missing pages', () => {
    // 0,1,2 then 5 -- resuming at 6 would silently lose pages 3-4.
    expect(
      findResumePoint([
        { index: 0, page: 1 },
        { index: 1, page: 1 },
        { index: 2, page: 2 },
        { index: 5, page: 4 }
      ])
    ).toEqual({ index: 3, page: 2 })
  })

  test('starts from scratch when index 0 is missing', () => {
    expect(
      findResumePoint([
        { index: 1, page: 1 },
        { index: 2, page: 2 }
      ])
    ).toEqual({ index: 0, page: undefined })
  })

  test('tolerates unsorted input', () => {
    expect(
      findResumePoint([
        { index: 2, page: 2 },
        { index: 0, page: 1 },
        { index: 1, page: 1 }
      ])
    ).toEqual({ index: 3, page: 2 })
  })

  test('ignores duplicate indices', () => {
    expect(
      findResumePoint([
        { index: 0, page: 1 },
        { index: 0, page: 1 },
        { index: 1, page: 2 }
      ])
    ).toEqual({ index: 2, page: 2 })
  })
})

describe('isCompletePng', () => {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  ])
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
  ])

  test('accepts a buffer with a PNG signature and IEND chunk', () => {
    expect(
      isCompletePng(Buffer.concat([signature, Buffer.alloc(32), iend]))
    ).toBe(true)
  })

  test('rejects a buffer truncated before IEND', () => {
    // A crash mid-write leaves a plausible-looking but unreadable file.
    expect(isCompletePng(Buffer.concat([signature, Buffer.alloc(32)]))).toBe(
      false
    )
  })

  test('rejects a buffer that is not a PNG at all', () => {
    expect(isCompletePng(Buffer.from('not a png at all, truly'))).toBe(false)
  })

  test('rejects an empty buffer', () => {
    expect(isCompletePng(Buffer.alloc(0))).toBe(false)
  })

  test('rejects a buffer shorter than the signature', () => {
    expect(isCompletePng(signature.subarray(0, 4))).toBe(false)
  })
})

describe('planExtractionResume', () => {
  test('starts fresh when nothing has been captured', () => {
    expect(planExtractionResume([])).toEqual({
      resumePage: undefined,
      keep: []
    })
  })

  test('drops the last page entirely and re-captures it', () => {
    // One Kindle page can span several screenshots, so a run interrupted
    // part-way through a page must redo that page rather than resume inside it.
    expect(
      planExtractionResume([
        { index: 0, page: 1 },
        { index: 1, page: 1 },
        { index: 2, page: 2 }
      ])
    ).toEqual({
      resumePage: 2,
      keep: [
        { index: 0, page: 1 },
        { index: 1, page: 1 }
      ]
    })
  })

  test('drops every screenshot belonging to the last page', () => {
    expect(
      planExtractionResume([
        { index: 0, page: 1 },
        { index: 1, page: 2 },
        { index: 2, page: 2 },
        { index: 3, page: 2 }
      ])
    ).toEqual({ resumePage: 2, keep: [{ index: 0, page: 1 }] })
  })

  test('starts fresh when only the first page was captured', () => {
    // Nothing worth keeping, so there is no resume to speak of.
    expect(planExtractionResume([{ index: 0, page: 1 }])).toEqual({
      resumePage: undefined,
      keep: []
    })
  })

  test('ignores captures beyond a gap', () => {
    expect(
      planExtractionResume([
        { index: 0, page: 1 },
        { index: 1, page: 2 },
        { index: 5, page: 9 }
      ])
    ).toEqual({ resumePage: 2, keep: [{ index: 0, page: 1 }] })
  })

  test('kept indices stay contiguous from zero', () => {
    const { keep } = planExtractionResume([
      { index: 0, page: 1 },
      { index: 1, page: 2 },
      { index: 2, page: 3 }
    ])
    expect(keep.map((page) => page.index)).toEqual([0, 1])
  })
})
