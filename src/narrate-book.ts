import 'dotenv/config'

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { KokoroTTS } from 'kokoro-js'

import type { BookMetadata, ContentChunk } from './types'
import { parseCliArgs } from './lib/cli'
import { resolveContentPath } from './lib/content'
import { createReporter } from './lib/events'
import {
  buildChapterMetadata,
  chaptersFromToc,
  encodeM4b,
  type PageDuration
} from './lib/m4b'
import { splitForNarration } from './lib/narration'
import { findVoice } from './lib/voices'
import { joinWavFiles, wavDurationSeconds } from './lib/wav'
import {
  assert,
  fileExists,
  hashObject,
  readJsonFile,
  tryReadJsonFile
} from './utils'

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
/** Characters per synthesis call. */
const PIECE_CHARS = 400

/**
 * Narrate a book locally with Kokoro and package it as an M4B audiobook.
 *
 * Synthesis runs page by page rather than over the whole text at once, so the
 * narration time of each page is known. That is what lets the table of
 * contents become real chapter markers -- the thing that makes an M4B an
 * audiobook rather than a very long audio file.
 *
 * Every piece is cached to disk before being joined, so an interrupted run
 * resumes instead of starting the book again.
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

  const metadata = await tryReadJsonFile<BookMetadata>(
    path.join(opts.bookDir, 'metadata.json')
  )

  const chunks = opts.limit ? content.slice(0, opts.limit) : content
  const voice = findVoice(opts.voice)!
  reporter.log(
    `narrating as ${voice.name} (${voice.accent} ${voice.gender.toLowerCase()}, Kokoro grade ${voice.grade})`
  )

  // The voice is part of the cache key, so switching voices re-synthesises
  // rather than joining pieces recorded by two different narrators.
  const cacheDir = path.join(
    opts.bookDir,
    'audio',
    hashObject({ model: MODEL_ID, voice: voice.id, chunks: chunks.length })
  )
  await fs.mkdir(cacheDir, { recursive: true })

  reporter.log(`loading ${MODEL_ID} (first run downloads the model)`)
  const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: 'q8',
    device: 'cpu'
  })

  const piecePaths: string[] = []
  const durations: PageDuration[] = []

  for (const [chunkIndex, chunk] of chunks.entries()) {
    const pieces = splitForNarration(chunk.text, PIECE_CHARS)
    let seconds = 0

    for (const [pieceIndex, piece] of pieces.entries()) {
      const piecePath = path.join(
        cacheDir,
        `${chunkIndex}`.padStart(6, '0') +
          '-' +
          `${pieceIndex}`.padStart(3, '0') +
          '.wav'
      )

      if (opts.force || !(await fileExists(piecePath))) {
        const audio = await tts.generate(piece, { voice: voice.id as any })
        await fs.writeFile(piecePath, Buffer.from(audio.toWav()))
      }

      piecePaths.push(piecePath)
      seconds += wavDurationSeconds(await fs.readFile(piecePath))
    }

    durations.push({ page: chunk.page, seconds })
    reporter.emit({
      event: 'page',
      index: chunkIndex,
      page: chunk.page,
      total: chunks.length
    })
  }

  assert(piecePaths.length, 'no audio was produced')

  const outFile = opts.outFile ?? path.join(opts.bookDir, 'audiobook.m4b')
  await fs.mkdir(path.dirname(outFile), { recursive: true })

  // Join to WAV first, then hand ffmpeg a single input: the alternative is a
  // concat demuxer file listing thousands of fragments.
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kindle-m4b-'))
  const joined = path.join(stagingDir, 'joined.wav')
  const metadataFile = path.join(stagingDir, 'chapters.txt')

  try {
    await joinWavFiles(joined, piecePaths)

    const chapters = metadata?.toc
      ? chaptersFromToc(metadata.toc, durations)
      : []
    await fs.writeFile(
      metadataFile,
      buildChapterMetadata(chapters, {
        title: metadata?.meta?.title,
        artist: metadata?.meta?.authorList?.join(', '),
        album: metadata?.meta?.title
      })
    )

    reporter.log(
      chapters.length
        ? `encoding M4B with ${chapters.length} chapters`
        : 'encoding M4B (no table of contents, so no chapter markers)'
    )

    await encodeM4b({ input: joined, output: outFile, metadataFile })
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true })
  }

  reporter.emit({ event: 'step-done', step: 'audio' })
  reporter.emit({ event: 'done', outFile })
}

await main()
