import 'dotenv/config'

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { KokoroTTS } from 'kokoro-js'

import type { BookMetadata, ContentChunk } from './types'
import { parseCliArgs } from './lib/cli'
import { resolveContentPath } from './lib/content'
import { createReporter } from './lib/events'
import { resolveFfmpeg } from './lib/ffmpeg-install'
import {
  buildChapterMetadata,
  chaptersFromToc,
  encodeM4b,
  type PageDuration
} from './lib/m4b'
import { splitForNarration } from './lib/narration'
import {
  describeRemaining,
  estimateRemainingMs,
  formatDuration,
  projectTotal,
  realtimeFactor
} from './lib/progress'
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
  const runStartedAt = Date.now()

  const content = await readJsonFile<ContentChunk[]>(
    await resolveContentPath(opts.bookDir)
  )
  assert(content.length, 'no book content found')

  const metadata = await tryReadJsonFile<BookMetadata>(
    path.join(opts.bookDir, 'metadata.json')
  )

  const chunks = opts.limit ? content.slice(0, opts.limit) : content
  const voice = findVoice(opts.voice)!
  const pace =
    opts.speed === 1 ? '' : ` at ${Math.round(opts.speed * 100)}% speed`
  reporter.log(
    `narrating ${chunks.length} page${chunks.length === 1 ? '' : 's'} as ${voice.name} (${voice.accent} ${voice.gender.toLowerCase()}, Kokoro grade ${voice.grade})${pace}`
  )

  // The voice is part of the cache key, so switching voices re-synthesises
  // rather than joining pieces recorded by two different narrators.
  const cacheDir = path.join(
    opts.bookDir,
    'audio',
    hashObject({
      model: MODEL_ID,
      voice: voice.id,
      speed: opts.speed,
      chunks: chunks.length
    })
  )
  await fs.mkdir(cacheDir, { recursive: true })

  reporter.log(`loading ${MODEL_ID} (first run downloads the model)`)
  const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: 'q8',
    device: 'cpu'
  })

  const piecePaths: string[] = []
  const durations: PageDuration[] = []
  const startedAt = Date.now()
  let audioSeconds = 0
  let synthesised = 0
  let reused = 0

  for (const [chunkIndex, chunk] of chunks.entries()) {
    const pieces = splitForNarration(chunk.text, PIECE_CHARS)
    let seconds = 0
    let pageSynthesised = 0

    for (const [pieceIndex, piece] of pieces.entries()) {
      const piecePath = path.join(
        cacheDir,
        `${chunkIndex}`.padStart(6, '0') +
          '-' +
          `${pieceIndex}`.padStart(3, '0') +
          '.wav'
      )

      if (opts.force || !(await fileExists(piecePath))) {
        const audio = await tts.generate(piece, {
          voice: voice.id as any,
          speed: opts.speed
        })
        await fs.writeFile(piecePath, Buffer.from(audio.toWav()))
        pageSynthesised++
      }

      piecePaths.push(piecePath)
      seconds += wavDurationSeconds(await fs.readFile(piecePath))
    }

    synthesised += pageSynthesised
    reused += pieces.length - pageSynthesised
    audioSeconds += seconds

    durations.push({ page: chunk.page, seconds })
    reporter.emit({
      event: 'page',
      index: chunkIndex,
      page: chunk.page,
      total: chunks.length
    })

    const done = chunkIndex + 1
    const elapsedMs = Date.now() - startedAt
    const remainingMs = estimateRemainingMs({
      completed: done,
      total: chunks.length,
      elapsedMs
    })
    const projectedAudio = projectTotal({
      completed: done,
      total: chunks.length,
      value: audioSeconds
    })

    const cached = pieces.length - pageSynthesised
    const parts = [
      `page ${chunk.page} (${done}/${chunks.length}): ${pageSynthesised} synthesised` +
        (cached ? `, ${cached} reused from cache` : ''),
      `${formatDuration(audioSeconds)} of audio so far`
    ]

    const eta = describeRemaining(remainingMs)
    if (eta) {
      parts.push(eta)
    }

    if (projectedAudio !== undefined && done < chunks.length) {
      parts.push(`roughly ${formatDuration(projectedAudio)} in total`)
    }

    reporter.log(parts.join(' · '))
  }

  const synthesisMs = Date.now() - startedAt
  reporter.log(
    `synthesis done: ${synthesised} piece${synthesised === 1 ? '' : 's'} synthesised, ${reused} reused from cache`
  )

  assert(piecePaths.length, 'no audio was produced')

  const outFile = opts.outFile ?? path.join(opts.bookDir, 'audiobook.m4b')
  await fs.mkdir(path.dirname(outFile), { recursive: true })

  // Join to WAV first, then hand ffmpeg a single input: the alternative is a
  // concat demuxer file listing thousands of fragments.
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kindle-m4b-'))
  const joined = path.join(stagingDir, 'joined.wav')
  const metadataFile = path.join(stagingDir, 'chapters.txt')

  try {
    // Resolved before the join so a missing ffmpeg is reported up front,
    // rather than after gigabytes of WAV have been written.
    const ffmpeg = await resolveFfmpeg({
      home: os.homedir(),
      arch: process.arch === 'arm64' ? 'arm64' : 'x64',
      onProgress: (message) => reporter.log(message)
    })

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

    await encodeM4b({ input: joined, output: outFile, metadataFile, ffmpeg })
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true })
  }

  // Measured rather than assumed: the factor is what makes the next book's
  // estimate right for this machine. A resumed run synthesised nothing, so it
  // has no speed to report -- "0.00x realtime" would read as a
  // catastrophically slow machine rather than as a cache hit.
  const factor = synthesised
    ? realtimeFactor({ elapsedMs: synthesisMs, audioSeconds })
    : undefined
  const detail = factor
    ? `${factor.toFixed(2)}x realtime over ${formatDuration(synthesisMs / 1000)} of synthesis${reused ? `, ${reused} pieces from cache` : ''}`
    : `${synthesised} synthesised, ${reused} from cache`

  reporter.log(
    `${formatDuration(audioSeconds)} of audio in ${formatDuration((Date.now() - runStartedAt) / 1000)} (${detail})`
  )

  reporter.emit({ event: 'step-done', step: 'audio' })
  reporter.emit({ event: 'done', outFile })
}

await main()
