import 'dotenv/config'

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { KokoroTTS } from 'kokoro-js'

import { parseLibraryCliArgs } from './lib/cli'
import { createReporter } from './lib/events'
import { buildChapterMetadata, encodeM4b } from './lib/m4b'
import { splitForNarration } from './lib/narration'
import { VOICES } from './lib/voices'
import { concatWav } from './lib/wav'
import { assert, fileExists } from './utils'

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const PIECE_CHARS = 400

const srcDir = path.dirname(fileURLToPath(import.meta.url))
const PREVIEW_TEXT_PATH = path.join(srcDir, 'assets', 'voice-preview.txt')

/**
 * Render an audition clip for every Kokoro voice.
 *
 * Deliberately a couple of minutes long rather than a few seconds: the thing
 * that decides whether a narrator is bearable for ten hours is not how it
 * sounds in one sentence.
 *
 * Existing clips are skipped, so an interrupted run resumes -- the whole set
 * takes about an hour on a CPU.
 */
async function main() {
  // eslint-disable-next-line no-process-env
  const opts = parseLibraryCliArgs(process.argv.slice(2), process.env)
  const reporter = createReporter({ json: opts.json })

  const outDir =
    opts.outFile ?? path.join(path.dirname(opts.userDataDir), 'previews')
  await fs.mkdir(outDir, { recursive: true })

  const text = await fs.readFile(PREVIEW_TEXT_PATH, 'utf8')
  const pieces = splitForNarration(text, PIECE_CHARS)

  const wanted = opts.voiceIds && new Set(opts.voiceIds)
  const voices = wanted
    ? VOICES.filter((voice) => wanted.has(voice.id))
    : VOICES
  assert(voices.length, 'no voices selected')

  reporter.log(`loading ${MODEL_ID}`)
  const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: 'q8',
    device: 'cpu'
  })

  for (const [index, voice] of voices.entries()) {
    // Speed is part of the filename so auditions at different paces coexist.
    const suffix = opts.speed === 1 ? '' : `@${opts.speed}x`
    const outFile = path.join(outDir, `${voice.id}${suffix}.m4b`)

    if (!opts.force && (await fileExists(outFile))) {
      reporter.log(`${voice.id}: already rendered`)
    } else {
      const parts: Buffer[] = []
      for (const piece of pieces) {
        const audio = await tts.generate(piece, {
          voice: voice.id as any,
          speed: opts.speed
        })
        parts.push(Buffer.from(audio.toWav()))
      }

      const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'kindle-prev-'))
      try {
        const wav = path.join(staging, 'preview.wav')
        const meta = path.join(staging, 'meta.txt')
        await fs.writeFile(wav, concatWav(parts))
        await fs.writeFile(
          meta,
          buildChapterMetadata([], {
            title:
              opts.speed === 1
                ? `${voice.name} \u2014 voice preview`
                : `${voice.name} \u2014 voice preview at ${Math.round(opts.speed * 100)}%`,
            artist: `Kokoro ${voice.accent} ${voice.gender.toLowerCase()}`
          })
        )
        await encodeM4b({ input: wav, output: outFile, metadataFile: meta })
      } finally {
        await fs.rm(staging, { recursive: true, force: true })
      }

      reporter.log(`${voice.id}: rendered ${voice.name}`)
    }

    reporter.emit({
      event: 'page',
      index,
      page: index + 1,
      total: voices.length
    })
  }

  const manifest = path.join(outDir, 'voices.json')
  await fs.writeFile(
    manifest,
    JSON.stringify(
      voices.map((voice) => ({
        ...voice,
        speed: opts.speed,
        preview: `${voice.id}${suffixFor(opts.speed)}.m4b`
      })),
      null,
      2
    )
  )

  reporter.emit({ event: 'done', outFile: manifest })
}

function suffixFor(speed: number): string {
  return speed === 1 ? '' : `@${speed}x`
}

await main()
