import fs from 'node:fs/promises'

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

/**
 * Join WAV files on disk, streaming rather than buffering.
 *
 * A full novel is hours of audio -- gigabytes of samples -- so building the
 * result with `concatWav` would hold it twice in memory and fail at the very
 * last step, after all the synthesis work is already done. Here the header is
 * written as a placeholder, each part is appended in turn, and the size
 * fields are patched once the total is known.
 */
export async function joinWavFiles(
  outFile: string,
  piecePaths: string[]
): Promise<void> {
  if (!piecePaths.length) {
    throw new Error('no audio to join')
  }

  const out = await fs.open(outFile, 'w')

  try {
    await out.write(Buffer.alloc(HEADER_BYTES))

    let format: Omit<Wav, 'data'> | undefined
    let total = 0

    for (const piecePath of piecePaths) {
      const piece = parseWav(await fs.readFile(piecePath))

      if (!format) {
        format = piece
      } else if (
        piece.sampleRate !== format.sampleRate ||
        piece.channels !== format.channels ||
        piece.audioFormat !== format.audioFormat ||
        piece.bitsPerSample !== format.bitsPerSample
      ) {
        throw new Error(`mismatched sample format in ${piecePath}`)
      }

      await out.write(piece.data)
      total += piece.data.length
    }

    // Rewrite the header now that the total length is known.
    const header = encodeWav(Buffer.alloc(0), format!).subarray(0, HEADER_BYTES)
    header.writeUInt32LE(HEADER_BYTES - 8 + total, 4)
    header.writeUInt32LE(total, 40)
    await out.write(header, 0, HEADER_BYTES, 0)
  } finally {
    await out.close()
  }
}
