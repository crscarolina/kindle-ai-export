import 'dotenv/config'

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { KokoroTTS } from 'kokoro-js'

import { parseLibraryCliArgs } from './lib/cli'
import { createReporter } from './lib/events'
import { resolveFfmpeg } from './lib/ffmpeg-install'
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

  const ffmpeg = await resolveFfmpeg({
    home: os.homedir(),
    arch: process.arch === 'arm64' ? 'arm64' : 'x64',
    onProgress: (message) => reporter.log(message)
  })

  reporter.log(`loading ${MODEL_ID}`)
  const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: 'q8',
    device: 'cpu'
  })

  // Voice-major, so every pace of the best voice is ready before the set
  // moves on. A full matrix is hours of synthesis and is likely to be stopped
  // part-way; this makes the part that gets done the useful part.
  const jobs = voices.flatMap((voice) =>
    opts.speeds.map((speed) => ({ voice, speed }))
  )

  reporter.log(
    `${jobs.length} clip${jobs.length === 1 ? '' : 's'}: ${voices.length} voice${voices.length === 1 ? '' : 's'} at ${opts.speeds.length} pace${opts.speeds.length === 1 ? '' : 's'}`
  )

  for (const [index, { voice, speed }] of jobs.entries()) {
    const outFile = path.join(outDir, `${voice.id}${suffixFor(speed)}.m4b`)
    const label =
      speed === 1 ? voice.name : `${voice.name} at ${Math.round(speed * 100)}%`

    if (!opts.force && (await fileExists(outFile))) {
      reporter.log(`${label}: already rendered`)
    } else {
      const parts: Buffer[] = []
      for (const piece of pieces) {
        const audio = await tts.generate(piece, {
          voice: voice.id as any,
          speed
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
            title: `${label} \u2014 voice preview`,
            artist: `Kokoro ${voice.accent} ${voice.gender.toLowerCase()}`
          })
        )
        await encodeM4b({
          input: wav,
          output: outFile,
          metadataFile: meta,
          ffmpeg
        })
      } finally {
        await fs.rm(staging, { recursive: true, force: true })
      }

      reporter.log(`${label}: rendered`)
    }

    reporter.emit({
      event: 'page',
      index,
      page: index + 1,
      total: jobs.length
    })
  }

  const manifest = path.join(outDir, 'voices.json')
  await fs.writeFile(
    manifest,
    JSON.stringify(
      voices.map((voice) => ({
        ...voice,
        paces: opts.speeds,
        previews: Object.fromEntries(
          opts.speeds.map((speed) => [
            speed,
            `${voice.id}${suffixFor(speed)}.m4b`
          ])
        )
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
