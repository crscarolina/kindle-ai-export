/** A decoded WAV file. */
export type Wav = {
  sampleRate: number
  channels: number
  /** 1 for PCM, 3 for IEEE float. Kokoro emits 3. */
  audioFormat: number
  bitsPerSample: number
  /** Raw little-endian sample bytes, in the format described above. */
  data: Buffer
}

const HEADER_BYTES = 44

export type WavFormat = {
  sampleRate: number
  channels: number
  bitsPerSample?: number
  audioFormat?: number
}

/**
 * Wrap raw samples in a canonical 44-byte WAV header.
 *
 * The sample format has to be passed in, not assumed: Kokoro returns 32-bit
 * IEEE float, and writing a 16-bit PCM header over float samples produces a
 * file that is structurally valid and plays as static.
 */
export function encodeWav(
  data: Buffer,
  { sampleRate, channels, bitsPerSample = 16, audioFormat = 1 }: WavFormat
): Buffer {
  const header = Buffer.alloc(HEADER_BYTES)
  const blockAlign = (channels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign

  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(HEADER_BYTES - 8 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(audioFormat, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)

  return Buffer.concat([header, data])
}

/** Decode a WAV file, walking its chunks to find `fmt ` and `data`. */
export function parseWav(buf: Buffer): Wav {
  if (buf.length < 12) {
    throw new Error('invalid WAV: too short')
  }
  if (
    buf.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    buf.subarray(8, 12).toString('ascii') !== 'WAVE'
  ) {
    throw new Error('invalid WAV: missing RIFF/WAVE header')
  }

  let format: Omit<Wav, 'data'> | undefined
  let data: Buffer | undefined

  // Chunks are not required to appear in a fixed order or to be adjacent.
  let offset = 12
  while (offset + 8 <= buf.length) {
    const id = buf.subarray(offset, offset + 4).toString('ascii')
    const size = buf.readUInt32LE(offset + 4)
    const body = buf.subarray(
      offset + 8,
      Math.min(offset + 8 + size, buf.length)
    )

    if (id === 'fmt ') {
      format = {
        audioFormat: body.readUInt16LE(0),
        channels: body.readUInt16LE(2),
        sampleRate: body.readUInt32LE(4),
        bitsPerSample: body.readUInt16LE(14)
      }
    } else if (id === 'data') {
      data = body
    }

    // Chunks are word-aligned.
    offset += 8 + size + (size % 2)
  }

  if (!format || !data) {
    throw new Error('invalid WAV: missing fmt or data chunk')
  }

  return { ...format, data }
}

/**
 * Join WAV parts into one file.
 *
 * Mismatched formats are rejected rather than coerced. Concatenating audio
 * that disagrees on rate, channels, bit depth or sample encoding produces a
 * file whose header is entirely self-consistent and whose contents are noise,
 * so nothing surfaces the mistake until someone listens to the result.
 */
export function concatWav(parts: Buffer[]): Buffer {
  if (!parts.length) {
    throw new Error('no audio to join')
  }

  const decoded = parts.map((part) => parseWav(part))
  const [first] = decoded as [Wav, ...Wav[]]

  for (const part of decoded) {
    if (part.sampleRate !== first.sampleRate) {
      throw new Error(
        `mismatched sample rate: ${part.sampleRate} != ${first.sampleRate}`
      )
    }
    if (part.channels !== first.channels) {
      throw new Error(
        `mismatched channel count: ${part.channels} != ${first.channels}`
      )
    }
    if (part.audioFormat !== first.audioFormat) {
      throw new Error(
        `mismatched sample format: ${part.audioFormat} != ${first.audioFormat}`
      )
    }
    if (part.bitsPerSample !== first.bitsPerSample) {
      throw new Error(
        `mismatched bit depth: ${part.bitsPerSample} != ${first.bitsPerSample}`
      )
    }
  }

  return encodeWav(Buffer.concat(decoded.map((part) => part.data)), first)
}
