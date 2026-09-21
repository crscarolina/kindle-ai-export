import { describe, expect, test } from 'vitest'

import { buildChapterMetadata, chaptersFromToc } from './m4b'

describe('chaptersFromToc', () => {
  const toc = [
    { label: 'Chapter One', positionId: 0, page: 1, depth: 0 },
    { label: 'Chapter Two', positionId: 1, page: 3, depth: 0 },
    { label: 'Chapter Three', positionId: 2, page: 5, depth: 0 }
  ] as any

  const durations = [
    { page: 1, seconds: 10 },
    { page: 2, seconds: 10 },
    { page: 3, seconds: 20 },
    { page: 4, seconds: 20 },
    { page: 5, seconds: 30 }
  ]

  test('starts the first chapter at zero', () => {
    expect(chaptersFromToc(toc, durations)[0]!.startMs).toBe(0)
  })

  test('starts each chapter where the previous one ends', () => {
    const chapters = chaptersFromToc(toc, durations)
    expect(chapters[1]!.startMs).toBe(chapters[0]!.endMs)
    expect(chapters[2]!.startMs).toBe(chapters[1]!.endMs)
  })

  test('places a chapter boundary at the accumulated duration', () => {
    // Chapter Two begins at page 3, after two ten-second pages.
    expect(chaptersFromToc(toc, durations)[1]!.startMs).toBe(20_000)
  })

  test('ends the last chapter at the total duration', () => {
    const chapters = chaptersFromToc(toc, durations)
    expect(chapters.at(-1)!.endMs).toBe(90_000)
  })

  test('carries the labels through', () => {
    expect(chaptersFromToc(toc, durations).map((c) => c.title)).toEqual([
      'Chapter One',
      'Chapter Two',
      'Chapter Three'
    ])
  })

  test('skips toc entries with no page', () => {
    const withCover = [
      { label: 'Cover', positionId: 0, depth: 0 },
      ...toc
    ] as any
    expect(chaptersFromToc(withCover, durations)).toHaveLength(3)
  })

  test('drops zero-length chapters rather than emitting an invalid range', () => {
    // Two toc entries on the same page would otherwise produce start == end,
    // which ffmpeg rejects.
    const duplicated = [
      { label: 'One', positionId: 0, page: 1, depth: 0 },
      { label: 'Also One', positionId: 1, page: 1, depth: 0 },
      { label: 'Two', positionId: 2, page: 3, depth: 0 }
    ] as any
    const chapters = chaptersFromToc(duplicated, durations)
    expect(chapters.every((c) => c.endMs > c.startMs)).toBe(true)
  })

  test('returns nothing when there are no pages to place', () => {
    expect(chaptersFromToc([] as any, durations)).toEqual([])
  })

  test('returns nothing when there is no audio', () => {
    expect(chaptersFromToc(toc, [])).toEqual([])
  })
})

describe('buildChapterMetadata', () => {
  const chapters = [
    { title: 'Chapter One', startMs: 0, endMs: 20_000 },
    { title: 'Chapter Two', startMs: 20_000, endMs: 90_000 }
  ]

  test('opens with the ffmetadata header', () => {
    expect(buildChapterMetadata(chapters, {})).toMatch(/^;FFMETADATA1\n/)
  })

  test('writes one chapter block per chapter', () => {
    const meta = buildChapterMetadata(chapters, {})
    expect(meta.match(/\[CHAPTER\]/g)).toHaveLength(2)
  })

  test('uses a millisecond timebase', () => {
    expect(buildChapterMetadata(chapters, {})).toContain('TIMEBASE=1/1000')
  })

  test('writes start and end for each chapter', () => {
    const meta = buildChapterMetadata(chapters, {})
    expect(meta).toContain('START=0')
    expect(meta).toContain('END=20000')
    expect(meta).toContain('START=20000')
    expect(meta).toContain('END=90000')
  })

  test('includes the book title and author', () => {
    const meta = buildChapterMetadata(chapters, {
      title: 'Uprooted',
      artist: 'Naomi Novik'
    })
    expect(meta).toContain('title=Uprooted')
    expect(meta).toContain('artist=Naomi Novik')
  })

  test('escapes characters ffmetadata treats as syntax', () => {
    // An unescaped = or ; would truncate or comment out the title.
    const meta = buildChapterMetadata(
      [{ title: 'A=B;C\\D', startMs: 0, endMs: 1000 }],
      {}
    )
    expect(meta).toContain(String.raw`title=A\=B\;C\\D`)
  })

  test('escapes newlines in a chapter title', () => {
    const meta = buildChapterMetadata(
      [{ title: 'Two\nLines', startMs: 0, endMs: 1000 }],
      {}
    )
    expect(meta.split('\n').filter((l) => l.startsWith('title='))).toHaveLength(
      1
    )
  })

  test('omits absent metadata fields', () => {
    expect(buildChapterMetadata(chapters, {})).not.toContain('artist=')
  })
})

describe('chaptersFromToc beyond the narrated range', () => {
  // A preview run narrates the first few pages only, while the table of
  // contents still describes the whole book.
  const toc = [
    { label: 'One', positionId: 0, page: 1, depth: 0 },
    { label: 'Two', positionId: 1, page: 50, depth: 0 },
    { label: 'Three', positionId: 2, page: 90, depth: 0 }
  ] as any

  const narrated = [
    { page: 1, seconds: 10 },
    { page: 2, seconds: 10 }
  ]

  test('drops chapters whose pages were never narrated', () => {
    expect(chaptersFromToc(toc, narrated).map((c) => c.title)).toEqual(['One'])
  })

  test('ends the surviving chapter at the end of the audio', () => {
    expect(chaptersFromToc(toc, narrated)[0]!.endMs).toBe(20_000)
  })

  test('never emits a zero-length chapter', () => {
    for (const chapter of chaptersFromToc(toc, narrated)) {
      expect(chapter.endMs).toBeGreaterThan(chapter.startMs)
    }
  })

  test('emits nothing when no chapter falls inside the narrated range', () => {
    expect(
      chaptersFromToc(
        [{ label: 'Late', positionId: 0, page: 900, depth: 0 }] as any,
        narrated
      )
    ).toEqual([])
  })

  test('keeps every chapter when the whole book was narrated', () => {
    const full = [
      { page: 1, seconds: 10 },
      { page: 50, seconds: 10 },
      { page: 90, seconds: 10 }
    ]
    expect(chaptersFromToc(toc, full)).toHaveLength(3)
  })
})

describe('chaptersFromToc with pages spanning several chunks', () => {
  // One Kindle page routinely produces several content chunks, so a page
  // number repeats in the duration list.
  const toc = [
    { label: 'One', positionId: 0, page: 1, depth: 0 },
    { label: 'Two', positionId: 1, page: 2, depth: 0 }
  ] as any

  const durations = [
    { page: 1, seconds: 10 },
    { page: 1, seconds: 10 },
    { page: 2, seconds: 10 },
    { page: 2, seconds: 10 }
  ]

  test('a chapter starts where its page first begins, not where it last resumes', () => {
    expect(chaptersFromToc(toc, durations)[0]!.startMs).toBe(0)
  })

  test('the following chapter starts at its own first chunk', () => {
    expect(chaptersFromToc(toc, durations)[1]!.startMs).toBe(20_000)
  })

  test('the last chapter runs to the end of the audio', () => {
    // Otherwise the tail of the book sits outside any chapter.
    expect(chaptersFromToc(toc, durations).at(-1)!.endMs).toBe(40_000)
  })

  test('chapters tile the whole timeline without gaps', () => {
    const chapters = chaptersFromToc(toc, durations)
    expect(chapters[0]!.endMs).toBe(chapters[1]!.startMs)
    expect(chapters[0]!.startMs).toBe(0)
  })
})
