import fs from 'node:fs'

import { describe, expect, test } from 'vitest'

import {
  DEFAULT_VOICE,
  findVoice,
  longFormVoices,
  PREVIEW_PACES,
  voiceIds,
  VOICES
} from './voices'

/** The voice table kokoro-js actually ships, read out of its bundle. */
function kokoroVoices(): Record<string, any> {
  const source = fs.readFileSync(
    'node_modules/kokoro-js/dist/kokoro.js',
    'utf8'
  )
  const start = source.indexOf('Object.freeze({af_heart')
  const open = source.indexOf('{', start + 13)

  let depth = 0
  let end = -1
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }

  // eslint-disable-next-line no-eval
  return eval(`(${source.slice(open, end)})`)
}

describe('the catalogue matches kokoro-js', () => {
  const shipped = kokoroVoices()

  test('covers every voice the model ships', () => {
    // A mismatch means the catalogue has drifted from the dependency, and the
    // UI would offer a voice that cannot be synthesised.
    expect(voiceIds().toSorted()).toEqual(Object.keys(shipped).toSorted())
  })

  test('agrees on every name, gender and grade', () => {
    for (const voice of VOICES) {
      const theirs = shipped[voice.id]
      expect(voice.name, voice.id).toBe(theirs.name)
      expect(voice.gender, voice.id).toBe(theirs.gender)
      expect(voice.grade, voice.id).toBe(theirs.overallGrade)
      expect(voice.targetQuality, voice.id).toBe(theirs.targetQuality)
    }
  })

  test('derives the accent from the language tag', () => {
    for (const voice of VOICES) {
      const expected =
        shipped[voice.id].language === 'en-gb' ? 'British' : 'American'
      expect(voice.accent, voice.id).toBe(expected)
    }
  })

  test('carries over every trait marker', () => {
    for (const voice of VOICES) {
      expect(voice.traits, voice.id).toBe(shipped[voice.id].traits)
    }
  })
})

describe('the catalogue is usable', () => {
  test('has no duplicate ids', () => {
    expect(new Set(voiceIds()).size).toBe(VOICES.length)
  })

  test('the default voice exists', () => {
    expect(findVoice(DEFAULT_VOICE)).toBeDefined()
  })

  test('the default is the top-graded voice', () => {
    expect(findVoice(DEFAULT_VOICE)!.grade).toBe('A')
  })

  test('every voice has a description of real substance', () => {
    for (const voice of VOICES) {
      expect(voice.description.length, voice.id).toBeGreaterThan(120)
    }
  })

  test('no description is a placeholder', () => {
    for (const voice of VOICES) {
      expect(voice.description, voice.id).not.toMatch(/TODO|Lorem|TBD/i)
    }
  })

  test('every description ends as a sentence', () => {
    for (const voice of VOICES) {
      expect(voice.description.trimEnd().endsWith('.'), voice.id).toBe(true)
    }
  })

  test('finds a voice by id', () => {
    expect(findVoice('bm_george')!.name).toBe('George')
  })

  test('returns undefined for an unknown id', () => {
    expect(findVoice('am_nobody')).toBeUndefined()
  })

  test('recommends only the higher-graded voices for long form', () => {
    for (const voice of longFormVoices()) {
      expect(['A', 'A-', 'B+', 'B', 'B-'], voice.id).toContain(voice.grade)
    }
  })

  test('recommends at least one voice of each accent for long form', () => {
    const accents = new Set(longFormVoices().map((voice) => voice.accent))
    expect(accents).toContain('American')
    expect(accents).toContain('British')
  })

  test('lists the default first', () => {
    expect(VOICES[0]!.id).toBe(DEFAULT_VOICE)
  })
})

describe('PREVIEW_PACES', () => {
  test('includes the natural pace', () => {
    expect(PREVIEW_PACES).toContain(1)
  })

  test('is sorted slowest first', () => {
    expect(PREVIEW_PACES).toEqual([...PREVIEW_PACES].toSorted((a, b) => a - b))
  })

  test('has no duplicates', () => {
    expect(new Set(PREVIEW_PACES).size).toBe(PREVIEW_PACES.length)
  })

  test('stays inside the range the CLI accepts', () => {
    // parseSpeed rejects anything outside 0.5-2.0, so a pace here that fell
    // outside would render fine and then be unselectable.
    for (const pace of PREVIEW_PACES) {
      expect(pace).toBeGreaterThanOrEqual(0.5)
      expect(pace).toBeLessThanOrEqual(2)
    }
  })
})
