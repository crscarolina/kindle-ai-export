/** A decoded 16-bit PCM WAV file. */
export type Wav = {
  sampleRate: number
  channels: number
  /** Raw little-endian 16-bit PCM samples. */
  data: Buffer
}

const HEADER_BYTES = 44
const BITS_PER_SAMPLE = 16

/**
 * Wrap raw 16-bit PCM samples in a canonical 44-byte WAV header.
 *
 * Kokoro emits PCM, and the project deliberately has no ffmpeg dependency for
 * local narration, so the header is written here rather than shelled out.
 */
export function encodeWav(
  data: Buffer,
  { sampleRate, channels }: { sampleRate: number; channels: number }
): Buffer {
  const header = Buffer.alloc(HEADER_BYTES)
  const byteRate = (sampleRate * channels * BITS_PER_SAMPLE) / 8
  const blockAlign = (channels * BITS_PER_SAMPLE) / 8

  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(HEADER_BYTES - 8 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // PCM fmt chunk size
  header.writeUInt16LE(1, 20) // audio format: PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(BITS_PER_SAMPLE, 34)
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

  let sampleRate: number | undefined
  let channels: number | undefined
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
      channels = body.readUInt16LE(2)
      sampleRate = body.readUInt32LE(4)
    } else if (id === 'data') {
      data = body
    }

    // Chunks are word-aligned.
    offset += 8 + size + (size % 2)
  }

  if (sampleRate === undefined || channels === undefined || !data) {
    throw new Error('invalid WAV: missing fmt or data chunk')
  }

  return { sampleRate, channels, data }
}

/**
 * Join WAV parts into one file.
 *
 * Mismatched formats are rejected rather than coerced: concatenating PCM at
 * two different sample rates produces a file that plays the later half at the
 * wrong speed, which nothing would surface until someone listened to it.
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
  }

  return encodeWav(Buffer.concat(decoded.map((part) => part.data)), {
    sampleRate: first.sampleRate,
    channels: first.channels
  })
}
