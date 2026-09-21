import { describe, expect, test } from 'vitest'

import {
  createReporter,
  type ExportEvent,
  formatEvent,
  parseEvent
} from './events'

describe('formatEvent', () => {
  test('emits a single line terminated by a newline', () => {
    const line = formatEvent({ event: 'step-start', step: 'extract' })
    expect(line.endsWith('\n')).toBe(true)
    expect(line.trimEnd().split('\n')).toHaveLength(1)
  })

  test('escapes newlines in a message so the stream stays line-delimited', () => {
    // A multi-line error message must not break the NDJSON framing.
    const line = formatEvent({
      event: 'error',
      message: 'first line\nsecond line'
    })
    expect(line.trimEnd().split('\n')).toHaveLength(1)
    expect(parseEvent(line)).toEqual({
      event: 'error',
      message: 'first line\nsecond line'
    })
  })

  test('round-trips a page-progress event', () => {
    const event: ExportEvent = {
      event: 'page',
      index: 12,
      page: 9,
      total: 380
    }
    expect(parseEvent(formatEvent(event))).toEqual(event)
  })
})

describe('parseEvent', () => {
  test('parses a line with a trailing newline', () => {
    expect(parseEvent('{"event":"session-expired"}\n')).toEqual({
      event: 'session-expired'
    })
  })

  test('returns undefined for a blank line', () => {
    expect(parseEvent('')).toBeUndefined()
    expect(parseEvent('   \n')).toBeUndefined()
  })

  test('returns undefined for non-JSON prose', () => {
    // The scripts still log prose to stderr; the decoder must not choke.
    expect(parseEvent('Looking for Reader settings button')).toBeUndefined()
  })

  test('returns undefined for JSON without an event discriminant', () => {
    expect(parseEvent('{"page":3}')).toBeUndefined()
  })

  test('returns undefined for a JSON array', () => {
    expect(parseEvent('[1,2,3]')).toBeUndefined()
  })

  test('returns undefined for a non-string event discriminant', () => {
    expect(parseEvent('{"event":42}')).toBeUndefined()
  })
})

describe('createReporter', () => {
  test('writes NDJSON when json mode is on', () => {
    const lines: string[] = []
    const reporter = createReporter({
      json: true,
      write: (chunk) => lines.push(chunk)
    })

    reporter.emit({ event: 'step-start', step: 'transcribe' })
    reporter.emit({ event: 'page', index: 1, page: 1, total: 2 })

    expect(lines.map((line) => parseEvent(line))).toEqual([
      { event: 'step-start', step: 'transcribe' },
      { event: 'page', index: 1, page: 1, total: 2 }
    ])
  })

  test('writes human-readable prose when json mode is off', () => {
    const lines: string[] = []
    const reporter = createReporter({
      json: false,
      write: (chunk) => lines.push(chunk)
    })

    reporter.emit({ event: 'error', message: 'boom' })

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('boom')
    expect(parseEvent(lines[0]!)).toBeUndefined()
  })

  test('log() is a shorthand for a log event', () => {
    const lines: string[] = []
    const reporter = createReporter({
      json: true,
      write: (chunk) => lines.push(chunk)
    })

    reporter.log('hello')

    expect(parseEvent(lines[0]!)).toEqual({ event: 'log', message: 'hello' })
  })

  test('every line written in json mode is independently parseable', () => {
    const lines: string[] = []
    const reporter = createReporter({
      json: true,
      write: (chunk) => lines.push(chunk)
    })

    reporter.log('a\nb')
    reporter.emit({ event: 'done' })

    for (const line of lines) {
      expect(line.trimEnd().split('\n')).toHaveLength(1)
      expect(parseEvent(line)).toBeDefined()
    }
  })
})
