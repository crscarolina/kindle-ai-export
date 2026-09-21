import { describe, expect, test } from 'vitest'

import type { ContentChunk } from '../types'
import {
  applyCleanup,
  batchChunks,
  buildCleanupPrompt,
  parseCleanupResponse
} from './cleanup'

function chunk(index: number, text: string): ContentChunk {
  return { index, page: index + 1, text, screenshot: '' }
}

describe('buildCleanupPrompt', () => {
  const chunks = [chunk(0, 'First page.'), chunk(1, 'Second page.')]

  test('delimits each chunk by index', () => {
    const prompt = buildCleanupPrompt(chunks)
    expect(prompt).toContain('<<<CHUNK 0>>>')
    expect(prompt).toContain('<<<CHUNK 1>>>')
  })

  test('includes every chunk’s text', () => {
    const prompt = buildCleanupPrompt(chunks)
    expect(prompt).toContain('First page.')
    expect(prompt).toContain('Second page.')
  })

  test('asks for the same delimiters back', () => {
    expect(buildCleanupPrompt(chunks)).toContain('<<<CHUNK n>>>')
  })
})

describe('parseCleanupResponse', () => {
  test('reads delimited chunks back', () => {
    expect(
      parseCleanupResponse('<<<CHUNK 0>>>\nFirst.\n<<<CHUNK 1>>>\nSecond.')
    ).toEqual(
      new Map([
        [0, 'First.'],
        [1, 'Second.']
      ])
    )
  })

  test('trims surrounding whitespace', () => {
    expect(parseCleanupResponse('<<<CHUNK 0>>>\n\n  Text.  \n\n')).toEqual(
      new Map([[0, 'Text.']])
    )
  })

  test('preserves blank lines inside a chunk', () => {
    expect(parseCleanupResponse('<<<CHUNK 0>>>\nOne.\n\nTwo.')).toEqual(
      new Map([[0, 'One.\n\nTwo.']])
    )
  })

  test('ignores preamble before the first delimiter', () => {
    // Models like to say "Here's the cleaned text:" first.
    expect(
      parseCleanupResponse("Here's the cleaned text:\n<<<CHUNK 0>>>\nText.")
    ).toEqual(new Map([[0, 'Text.']]))
  })

  test('returns an empty map when no delimiters are present', () => {
    expect(parseCleanupResponse('I could not do that.')).toEqual(new Map())
  })

  test('returns an empty map for empty input', () => {
    expect(parseCleanupResponse('')).toEqual(new Map())
  })

  test('keeps the last value when a chunk is repeated', () => {
    expect(parseCleanupResponse('<<<CHUNK 0>>>\nA\n<<<CHUNK 0>>>\nB')).toEqual(
      new Map([[0, 'B']])
    )
  })
})

describe('applyCleanup', () => {
  const chunks = [chunk(0, 'First page.'), chunk(1, 'Second page.')]

  test('replaces text with the cleaned version', () => {
    const result = applyCleanup(chunks, new Map([[0, 'First page!']]))
    expect(result[0]!.text).toBe('First page!')
  })

  test('keeps the original when a chunk is missing from the response', () => {
    // A dropped chunk must never mean dropped text.
    const result = applyCleanup(chunks, new Map([[0, 'First page!']]))
    expect(result[1]!.text).toBe('Second page.')
  })

  test('keeps the original when the cleaned text is empty', () => {
    const result = applyCleanup(chunks, new Map([[0, '']]))
    expect(result[0]!.text).toBe('First page.')
  })

  test('keeps the original when the cleaned text is suspiciously short', () => {
    // Guards against a truncated response silently deleting most of a page.
    const result = applyCleanup(chunks, new Map([[0, 'F']]))
    expect(result[0]!.text).toBe('First page.')
  })

  test('accepts a modest shortening', () => {
    const long = chunk(0, 'The quick brown fox jumps over the lazy dog again.')
    const result = applyCleanup(
      [long],
      new Map([[0, 'The quick brown fox jumps over the lazy dog.']])
    )
    expect(result[0]!.text).toBe('The quick brown fox jumps over the lazy dog.')
  })

  test('accepts a longer cleaned version', () => {
    // Expanding "Ch. 3" to "Chapter Three" makes text longer, not shorter.
    const result = applyCleanup(
      [chunk(0, 'Ch. 3')],
      new Map([[0, 'Chapter Three']])
    )
    expect(result[0]!.text).toBe('Chapter Three')
  })

  test('preserves every other field', () => {
    const result = applyCleanup(chunks, new Map([[0, 'First page!']]))
    expect(result[0]!.index).toBe(0)
    expect(result[0]!.page).toBe(1)
  })

  test('never changes the number of chunks', () => {
    expect(applyCleanup(chunks, new Map()).length).toBe(2)
    expect(
      applyCleanup(
        chunks,
        new Map([
          [0, 'a'],
          [1, 'b'],
          [99, 'ghost']
        ])
      ).length
    ).toBe(2)
  })
})

describe('batchChunks', () => {
  test('keeps chunks together while they fit', () => {
    const chunks = [chunk(0, 'aaa'), chunk(1, 'bbb')]
    expect(batchChunks(chunks, 100)).toEqual([chunks])
  })

  test('splits once the budget is exceeded', () => {
    const chunks = [chunk(0, 'aaaa'), chunk(1, 'bbbb'), chunk(2, 'cccc')]
    const batches = batchChunks(chunks, 8)
    expect(batches).toHaveLength(2)
    expect(batches[0]).toHaveLength(2)
    expect(batches[1]).toHaveLength(1)
  })

  test('never drops a chunk', () => {
    const chunks = Array.from({ length: 25 }, (_, i) =>
      chunk(i, 'x'.repeat(10))
    )
    const batched = batchChunks(chunks, 30).flat()
    expect(batched.map((c) => c.index)).toEqual(chunks.map((c) => c.index))
  })

  test('preserves order across batches', () => {
    const chunks = Array.from({ length: 10 }, (_, i) => chunk(i, 'y'.repeat(5)))
    const indices = batchChunks(chunks, 12)
      .flat()
      .map((c) => c.index)
    expect(indices).toEqual(indices.toSorted((a, b) => a - b))
  })

  test('gives an oversized chunk a batch of its own rather than dropping it', () => {
    const chunks = [chunk(0, 'x'.repeat(500)), chunk(1, 'small')]
    const batches = batchChunks(chunks, 100)
    expect(batches[0]).toEqual([chunks[0]])
    expect(batches.flat()).toHaveLength(2)
  })

  test('returns nothing for no chunks', () => {
    expect(batchChunks([], 100)).toEqual([])
  })
})
