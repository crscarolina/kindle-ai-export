import 'dotenv/config'

import fs from 'node:fs/promises'
import path from 'node:path'

import { KokoroTTS } from 'kokoro-js'

import type { ContentChunk } from './types'
import { parseCliArgs } from './lib/cli'
import { resolveContentPath } from './lib/content'
import { createReporter } from './lib/events'
import { splitForNarration } from './lib/narration'
import { concatWav } from './lib/wav'
import { assert, fileExists, hashObject, readJsonFile } from './utils'

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const VOICE = 'af_heart'
/** Characters per synthesis call. */
const PIECE_CHARS = 400

/**
 * Narrate a book locally with Kokoro.
 *
 * Runs entirely on the CPU with no API key and no per-word cost, and joins
 * the pieces into WAV directly rather than shelling out to ffmpeg.
 *
 * Every piece is cached to disk before being joined. Narrating a full novel
 * is a long job, so an interrupted run resumes from where it stopped instead
 * of starting the whole book again.
 */
async function main() {
  // eslint-disable-next-line no-process-env
  const opts = parseCliArgs(process.argv.slice(2), process.env)
  const reporter = createReporter({ json: opts.json })
  reporter.emit({ event: 'step-start', step: 'audio' })

  const content = await readJsonFile<ContentChunk[]>(
    await resolveContentPath(opts.bookDir)
  )
  assert(content.length, 'no book content found')

  const chunks = opts.limit ? content.slice(0, opts.limit) : content
  const text = chunks.map((chunk) => chunk.text).join('\n\n')
  const pieces = splitForNarration(text, PIECE_CHARS)
  assert(pieces.length, 'no text to narrate')

  const cacheDir = path.join(
    opts.bookDir,
    'audio',
    hashObject({ model: MODEL_ID, voice: VOICE, pieces: pieces.length })
  )
  await fs.mkdir(cacheDir, { recursive: true })

  reporter.log(`loading ${MODEL_ID} (first run downloads the model)`)
  const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: 'q8',
    device: 'cpu'
  })

  const parts: Buffer[] = []

  for (const [index, piece] of pieces.entries()) {
    const piecePath = path.join(cacheDir, `${index}`.padStart(6, '0') + '.wav')

    if (opts.force || !(await fileExists(piecePath))) {
      const audio = await tts.generate(piece, { voice: VOICE })
      await fs.writeFile(piecePath, Buffer.from(audio.toWav()))
    }

    parts.push(await fs.readFile(piecePath))
    reporter.emit({
      event: 'page',
      index,
      page: index + 1,
      total: pieces.length
    })
  }

  const outFile = opts.outFile ?? path.join(opts.bookDir, 'audiobook.wav')
  await fs.mkdir(path.dirname(outFile), { recursive: true })
  await fs.writeFile(outFile, concatWav(parts))

  reporter.emit({ event: 'step-done', step: 'audio' })
  reporter.emit({ event: 'done', outFile })
}

await main()
