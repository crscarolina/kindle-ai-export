import { describe, expect, test } from 'vitest'

import {
  captureProgress,
  describeRemaining,
  estimateRemainingMs,
  formatDuration,
  projectTotal,
  realtimeFactor
} from './progress'

describe('formatDuration', () => {
  test('formats seconds on their own', () => {
    expect(formatDuration(45)).toBe('45s')
  })

  test('formats zero', () => {
    expect(formatDuration(0)).toBe('0s')
  })

  test('formats minutes and seconds', () => {
    expect(formatDuration(90)).toBe('1m 30s')
  })

  test('drops a zero seconds part', () => {
    expect(formatDuration(600)).toBe('10m')
  })

  test('formats hours and minutes', () => {
    expect(formatDuration(3725)).toBe('1h 2m')
  })

  test('drops a zero minutes part', () => {
    expect(formatDuration(7200)).toBe('2h')
  })

  test('drops seconds once the duration runs to hours', () => {
    expect(formatDuration(3600 + 59)).toBe('1h')
  })

  test('rounds to the nearest second', () => {
    expect(formatDuration(89.6)).toBe('1m 30s')
    expect(formatDuration(0.4)).toBe('0s')
  })

  test('clamps a negative duration rather than printing a minus sign', () => {
    expect(formatDuration(-5)).toBe('0s')
  })

  test('refuses to invent a number it does not have', () => {
    expect(formatDuration(Number.NaN)).toBe('unknown')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('unknown')
  })
})

describe('estimateRemainingMs', () => {
  test('extrapolates from the completed work', () => {
    expect(
      estimateRemainingMs({ completed: 2, total: 10, elapsedMs: 4000 })
    ).toBe(16_000)
  })

  test('estimates from a single completed item', () => {
    expect(
      estimateRemainingMs({ completed: 1, total: 4, elapsedMs: 1000 })
    ).toBe(3000)
  })

  test('has no estimate before anything has finished', () => {
    expect(
      estimateRemainingMs({ completed: 0, total: 10, elapsedMs: 4000 })
    ).toBeUndefined()
  })

  test('has no estimate when no time has been measured', () => {
    expect(estimateRemainingMs({ completed: 3, total: 10, elapsedMs: 0 })).toBe(
      undefined
    )
  })

  test('reports nothing remaining once everything is done', () => {
    expect(
      estimateRemainingMs({ completed: 10, total: 10, elapsedMs: 4000 })
    ).toBe(0)
  })

  test('reports nothing remaining past the total', () => {
    expect(
      estimateRemainingMs({ completed: 11, total: 10, elapsedMs: 4000 })
    ).toBe(0)
  })

  test('has no estimate for an empty job', () => {
    expect(
      estimateRemainingMs({ completed: 0, total: 0, elapsedMs: 0 })
    ).toBeUndefined()
  })

  test('has no estimate from nonsense input', () => {
    expect(
      estimateRemainingMs({
        completed: 1,
        total: 10,
        elapsedMs: Number.NaN
      })
    ).toBeUndefined()
    expect(
      estimateRemainingMs({ completed: -1, total: 10, elapsedMs: 1000 })
    ).toBeUndefined()
  })
})

describe('describeRemaining', () => {
  test('phrases an estimate as an approximation', () => {
    expect(describeRemaining(95_000)).toBe('about 1m 35s left')
  })

  test('says nothing when there is no estimate', () => {
    expect(describeRemaining(undefined)).toBeUndefined()
  })

  test('says nothing rather than counting down the last second', () => {
    expect(describeRemaining(0)).toBeUndefined()
    expect(describeRemaining(500)).toBeUndefined()
  })

  test('says nothing from nonsense input', () => {
    expect(describeRemaining(Number.NaN)).toBeUndefined()
    expect(describeRemaining(-5000)).toBeUndefined()
  })
})

describe('projectTotal', () => {
  test('scales a partial measurement up to the whole job', () => {
    expect(projectTotal({ completed: 2, total: 10, value: 30 })).toBe(150)
  })

  test('projects from a single completed item', () => {
    expect(projectTotal({ completed: 1, total: 3, value: 12 })).toBe(36)
  })

  test('returns the measurement itself once the job is done', () => {
    expect(projectTotal({ completed: 10, total: 10, value: 300 })).toBe(300)
  })

  test('has no projection before anything has finished', () => {
    expect(projectTotal({ completed: 0, total: 10, value: 0 })).toBeUndefined()
  })

  test('has no projection for an empty job', () => {
    expect(projectTotal({ completed: 0, total: 0, value: 0 })).toBeUndefined()
  })

  test('projects zero from a zero measurement', () => {
    expect(projectTotal({ completed: 2, total: 10, value: 0 })).toBe(0)
  })

  test('has no projection from nonsense input', () => {
    expect(
      projectTotal({ completed: 2, total: 10, value: Number.NaN })
    ).toBeUndefined()
  })
})

describe('realtimeFactor', () => {
  test('reports compute seconds per second of audio', () => {
    expect(realtimeFactor({ elapsedMs: 11_000, audioSeconds: 10 })).toBeCloseTo(
      1.1
    )
  })

  test('reports faster than realtime as below one', () => {
    expect(realtimeFactor({ elapsedMs: 5000, audioSeconds: 10 })).toBe(0.5)
  })

  test('has no factor before any audio exists', () => {
    expect(realtimeFactor({ elapsedMs: 5000, audioSeconds: 0 })).toBeUndefined()
  })

  test('has no factor before any time has passed', () => {
    expect(realtimeFactor({ elapsedMs: 0, audioSeconds: 10 })).toBeUndefined()
  })

  test('has no factor from nonsense input', () => {
    expect(
      realtimeFactor({ elapsedMs: 1000, audioSeconds: Number.NaN })
    ).toBeUndefined()
    expect(
      realtimeFactor({ elapsedMs: -1000, audioSeconds: 10 })
    ).toBeUndefined()
  })
})

describe('captureProgress', () => {
  test('counts from the first content page, not from page one', () => {
    // Front matter sits before the first content page, so a book starting at
    // page 5 is zero percent done there, not already five pages in.
    expect(captureProgress({ current: 5, start: 5, total: 652 })).toEqual({
      index: 0,
      total: 648
    })
  })

  test('reaches exactly the total on the final page', () => {
    // The bug this guards: screenshots were counted against a page total, so
    // a 652-page book reported "741/652".
    const { index, total } = captureProgress({
      current: 652,
      start: 5,
      total: 652
    })
    expect(index + 1).toBe(total)
  })

  test('never exceeds the total', () => {
    const { index, total } = captureProgress({
      current: 999,
      start: 1,
      total: 652
    })
    expect(index).toBeLessThanOrEqual(total)
  })

  test('never goes negative before the first content page', () => {
    expect(captureProgress({ current: 1, start: 5, total: 652 }).index).toBe(0)
  })

  test('is monotonic across a book', () => {
    let previous = -1
    for (let page = 1; page <= 652; page++) {
      const { index } = captureProgress({ current: page, start: 5, total: 652 })
      expect(index).toBeGreaterThanOrEqual(previous)
      previous = index
    }
  })

  test('a page limit replaces the total', () => {
    // A preview of 50 pages should read out of 50, not out of the whole book.
    expect(
      captureProgress({ current: 10, start: 1, total: 652, limit: 50 }).total
    ).toBe(50)
  })

  test('handles a single-page book', () => {
    expect(captureProgress({ current: 1, start: 1, total: 1 })).toEqual({
      index: 0,
      total: 1
    })
  })

  test('falls back to one when the total is nonsense', () => {
    expect(
      captureProgress({ current: 1, start: 1, total: 0 }).total
    ).toBeGreaterThan(0)
  })
})
