import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { concatWav, encodeWav, joinWavFiles, parseWav } from './wav'

function tone(samples: number, { sampleRate = 24_000, channels = 1 } = {}) {
  const data = Buffer.alloc(samples * 2 * channels)
  for (let i = 0; i < samples * channels; i++) {
    data.writeInt16LE(((i * 1000) % 30_000) - 15_000, i * 2)
  }
  return encodeWav(data, { sampleRate, channels })
}

/** A float32 WAV, which is what Kokoro actually emits. */
function floatTone(
  samples: number,
  { sampleRate = 24_000, channels = 1 } = {}
) {
  const data = Buffer.alloc(samples * 4 * channels)
  for (let i = 0; i < samples * channels; i++) {
    data.writeFloatLE(Math.sin(i / 10), i * 4)
  }
  return encodeWav(data, {
    sampleRate,
    channels,
    bitsPerSample: 32,
    audioFormat: 3
  })
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

describe('float32 audio', () => {
  test('reads back the IEEE float format tag', () => {
    // Kokoro emits format 3 / 32-bit, not 16-bit PCM.
    expect(parseWav(floatTone(10)).audioFormat).toBe(3)
  })

  test('reads back the bit depth', () => {
    expect(parseWav(floatTone(10)).bitsPerSample).toBe(32)
  })

  test('round-trips float samples untouched', () => {
    const wav = floatTone(8)
    const parsed = parseWav(wav)
    expect(parsed.data).toEqual(wav.subarray(44))
  })

  test('joining float parts preserves the float format', () => {
    // Relabelling float samples as int16 is what makes a narration sound
    // like static, and every header field still looks self-consistent.
    const joined = parseWav(concatWav([floatTone(10), floatTone(10)]))
    expect(joined.audioFormat).toBe(3)
    expect(joined.bitsPerSample).toBe(32)
  })

  test('joining float parts keeps every sample byte', () => {
    const joined = parseWav(concatWav([floatTone(10), floatTone(15)]))
    expect(joined.data.length).toBe(25 * 4)
  })

  test('the joined byte rate matches the format', () => {
    const joined = concatWav([floatTone(10), floatTone(10)])
    expect(joined.readUInt32LE(28)).toBe(24_000 * 1 * 4)
    expect(joined.readUInt16LE(32)).toBe(4)
  })

  test('refuses to join float and int parts', () => {
    expect(() => concatWav([floatTone(10), tone(10)])).toThrow(/format/i)
  })

  test('refuses to join differing bit depths', () => {
    const wide = encodeWav(Buffer.alloc(8), {
      sampleRate: 24_000,
      channels: 1,
      bitsPerSample: 32,
      audioFormat: 1
    })
    const narrow = encodeWav(Buffer.alloc(8), {
      sampleRate: 24_000,
      channels: 1,
      bitsPerSample: 16,
      audioFormat: 1
    })
    expect(() => concatWav([wide, narrow])).toThrow(/bit depth|bits/i)
  })
})

describe('joinWavFiles', () => {
  const dirs: string[] = []

  async function write(parts: Buffer[]): Promise<string[]> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kindle-wav-'))
    dirs.push(dir)
    return Promise.all(
      parts.map(async (part, i) => {
        const file = path.join(dir, `${i}.wav`)
        await fs.writeFile(file, part)
        return file
      })
    )
  }

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true }))
    )
  })

  test('matches an in-memory join byte for byte', async () => {
    const parts = [floatTone(10), floatTone(15), floatTone(5)]
    const files = await write(parts)
    const out = path.join(path.dirname(files[0]!), 'joined.wav')

    await joinWavFiles(out, files)

    expect(await fs.readFile(out)).toEqual(concatWav(parts))
  })

  test('writes a header consistent with the streamed length', async () => {
    const files = await write([floatTone(10), floatTone(15)])
    const out = path.join(path.dirname(files[0]!), 'joined.wav')

    await joinWavFiles(out, files)
    const joined = await fs.readFile(out)

    expect(joined.readUInt32LE(4)).toBe(joined.length - 8)
    expect(joined.readUInt32LE(40)).toBe(joined.length - 44)
  })

  test('preserves the source sample format', async () => {
    const files = await write([floatTone(10), floatTone(10)])
    const out = path.join(path.dirname(files[0]!), 'joined.wav')

    await joinWavFiles(out, files)
    const parsed = parseWav(await fs.readFile(out))

    expect(parsed.audioFormat).toBe(3)
    expect(parsed.bitsPerSample).toBe(32)
    expect(parsed.sampleRate).toBe(24_000)
  })

  test('refuses mismatched formats rather than writing noise', async () => {
    const files = await write([floatTone(10), tone(10)])
    const out = path.join(path.dirname(files[0]!), 'joined.wav')

    await expect(joinWavFiles(out, files)).rejects.toThrow(/format/i)
  })

  test('refuses an empty list', async () => {
    await expect(joinWavFiles('/tmp/never-written.wav', [])).rejects.toThrow(
      /no audio/i
    )
  })
})
