import { describe, expect, test } from 'vitest'

import { splitForNarration } from './narration'

describe('splitForNarration', () => {
  test('keeps short text as a single piece', () => {
    expect(splitForNarration('One sentence.', 100)).toEqual(['One sentence.'])
  })

  test('splits at sentence boundaries', () => {
    expect(splitForNarration('One. Two. Three.', 10)).toEqual([
      'One. Two.',
      'Three.'
    ])
  })

  test('respects question and exclamation marks', () => {
    expect(splitForNarration('Why? Because! Yes.', 14)).toEqual([
      'Why? Because!',
      'Yes.'
    ])
  })

  test('never loses a word', () => {
    const text =
      'The quick brown fox. Jumps over the lazy dog. And then it rested. ' +
      'Again and again it ran. Until the sun set.'
    const words = splitForNarration(text, 30).join(' ').split(/\s+/)
    expect(words).toEqual(text.split(/\s+/))
  })

  test('emits an over-long sentence on its own rather than truncating it', () => {
    const long = `${'word '.repeat(50).trim()}.`
    const pieces = splitForNarration(`Short. ${long}`, 40)
    expect(pieces).toContain(long)
    expect(pieces.join(' ').split(/\s+/)).toEqual(`Short. ${long}`.split(/\s+/))
  })

  test('drops empty pieces', () => {
    expect(splitForNarration('One.   \n\n  Two.', 100)).toEqual(['One. Two.'])
  })

  test('returns nothing for empty text', () => {
    expect(splitForNarration('', 100)).toEqual([])
  })

  test('returns nothing for whitespace', () => {
    expect(splitForNarration('   \n  ', 100)).toEqual([])
  })

  test('handles text with no terminator', () => {
    expect(splitForNarration('no terminator here', 100)).toEqual([
      'no terminator here'
    ])
  })
})
