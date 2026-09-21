import { describe, expect, test } from 'vitest'

import { concatWav, encodeWav, parseWav } from './wav'

function tone(samples: number, { sampleRate = 24_000, channels = 1 } = {}) {
  const data = Buffer.alloc(samples * 2 * channels)
  for (let i = 0; i < samples * channels; i++) {
    data.writeInt16LE(((i * 1000) % 30_000) - 15_000, i * 2)
  }
  return encodeWav(data, { sampleRate, channels })
}

describe('encodeWav', () => {
  test('writes a RIFF/WAVE header', () => {
    const wav = tone(10)
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE')
  })

  test('records the sample rate', () => {
    expect(parseWav(tone(10, { sampleRate: 22_050 })).sampleRate).toBe(22_050)
  })

  test('records the channel count', () => {
    expect(parseWav(tone(10, { channels: 2 })).channels).toBe(2)
  })

  test('sets the RIFF size to the file length minus eight', () => {
    const wav = tone(16)
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8)
  })

  test('round-trips the sample data', () => {
    const data = Buffer.alloc(8)
    data.writeInt16LE(1234, 0)
    data.writeInt16LE(-4321, 2)
    expect(
      parseWav(encodeWav(data, { sampleRate: 24_000, channels: 1 })).data
    ).toEqual(data)
  })
})

describe('parseWav', () => {
  test('rejects a buffer that is not RIFF', () => {
    expect(() => parseWav(Buffer.alloc(64))).toThrow(/RIFF/)
  })

  test('rejects a truncated header', () => {
    expect(() => parseWav(Buffer.from('RIFF'))).toThrow()
  })
})

describe('concatWav', () => {
  test('sums the sample data of every part', () => {
    const joined = parseWav(concatWav([tone(10), tone(15)]))
    expect(joined.data.length).toBe(parseWav(tone(25)).data.length)
  })

  test('keeps the sample rate', () => {
    expect(parseWav(concatWav([tone(10), tone(10)])).sampleRate).toBe(24_000)
  })

  test('preserves sample order across parts', () => {
    const a = encodeWav(Buffer.from([1, 0, 2, 0]), {
      sampleRate: 24_000,
      channels: 1
    })
    const b = encodeWav(Buffer.from([3, 0, 4, 0]), {
      sampleRate: 24_000,
      channels: 1
    })
    expect([...parseWav(concatWav([a, b])).data]).toEqual([
      1, 0, 2, 0, 3, 0, 4, 0
    ])
  })

  test('writes a header consistent with the joined length', () => {
    const joined = concatWav([tone(10), tone(15)])
    expect(joined.readUInt32LE(4)).toBe(joined.length - 8)
  })

  test('handles a single part', () => {
    expect(parseWav(concatWav([tone(10)])).data.length).toBe(20)
  })

  test('rejects an empty list rather than writing a silent file', () => {
    expect(() => concatWav([])).toThrow(/no audio/i)
  })

  test('refuses mismatched sample rates', () => {
    // Joining these would play the second half at the wrong speed.
    expect(() =>
      concatWav([
        tone(10, { sampleRate: 24_000 }),
        tone(10, { sampleRate: 16_000 })
      ])
    ).toThrow(/sample rate/i)
  })

  test('refuses mismatched channel counts', () => {
    expect(() =>
      concatWav([tone(10, { channels: 1 }), tone(10, { channels: 2 })])
    ).toThrow(/channel/i)
  })
})
