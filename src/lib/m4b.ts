import { spawn } from 'node:child_process'

import type { TocItem } from '../types'

/** A chapter marker in the finished audiobook. */
export type Chapter = {
  title: string
  startMs: number
  endMs: number
}

/** How long each page or location of narration runs. */
export type PageDuration = {
  page: number
  seconds: number
}

/**
 * Turn the book's table of contents into chapter markers.
 *
 * Chapters are what make an M4B an audiobook rather than a long audio file:
 * players use them to skip, resume and show position. Boundaries come from
 * accumulating the narration time of the pages preceding each entry.
 */
export function chaptersFromToc(
  toc: TocItem[],
  durations: PageDuration[]
): Chapter[] {
  if (!toc?.length || !durations.length) {
    return []
  }

  // Elapsed milliseconds at the start of each page.
  //
  // One Kindle page produces several content chunks, so a page number repeats
  // here. The first sighting is where the page begins; later ones are where it
  // resumes, and taking those would push every chapter boundary late and leave
  // the tail of the book outside any chapter.
  const startOfPage = new Map<number, number>()
  let elapsed = 0
  for (const { page, seconds } of durations) {
    if (!startOfPage.has(page)) {
      startOfPage.set(page, Math.round(elapsed * 1000))
    }
    elapsed += seconds
  }

  const totalMs = Math.round(elapsed * 1000)

  // Only pages that were actually narrated can anchor a chapter. A preview
  // run covers the first few pages while the table of contents still
  // describes the whole book, and placing those chapters would pile them all
  // onto position zero.
  const entries = toc.filter(
    (item) => item.page !== undefined && startOfPage.has(item.page)
  )

  const chapters: Chapter[] = []
  for (const [index, item] of entries.entries()) {
    const startMs = startOfPage.get(item.page!)!
    const next = entries[index + 1]
    const endMs =
      next?.page === undefined
        ? totalMs
        : (startOfPage.get(next.page) ?? totalMs)

    // Two entries on the same page would give start == end, which ffmpeg
    // rejects outright.
    if (endMs > startMs) {
      chapters.push({ title: item.label, startMs, endMs })
    }
  }

  return chapters
}

/** `=`, `;`, `#`, `\` and newlines are ffmetadata syntax and must be escaped. */
function escapeMetadata(value: string): string {
  // String.raw throughout: a `'\;'` written by hand is just `';'`, so a lost
  // backslash silently stops escaping and ffmetadata reads the rest as syntax.
  return value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('=', String.raw`\=`)
    .replaceAll(';', String.raw`\;`)
    .replaceAll('#', String.raw`\#`)
    .replaceAll('\n', ' ')
}

/** Render an ffmetadata file describing the book and its chapters. */
export function buildChapterMetadata(
  chapters: Chapter[],
  tags: { title?: string; artist?: string; album?: string }
): string {
  const lines = [';FFMETADATA1']

  for (const [key, value] of Object.entries(tags)) {
    if (value) {
      lines.push(`${key}=${escapeMetadata(value)}`)
    }
  }

  for (const chapter of chapters) {
    lines.push(
      '[CHAPTER]',
      'TIMEBASE=1/1000',
      `START=${chapter.startMs}`,
      `END=${chapter.endMs}`,
      `title=${escapeMetadata(chapter.title)}`
    )
  }

  return `${lines.join('\n')}\n`
}

export class FfmpegMissingError extends Error {
  constructor() {
    super(
      'ffmpeg not found on PATH. Install it with `brew install ffmpeg` to produce M4B audiobooks.'
    )
    this.name = 'FfmpegMissingError'
  }
}

/**
 * Encode a WAV into an M4B audiobook.
 *
 * M4B is an MP4 container carrying AAC audio plus chapter markers; the
 * extension is what tells players to treat it as a book -- remembering
 * position, offering a chapter list -- rather than as music.
 */
export async function encodeM4b({
  input,
  output,
  metadataFile,
  bitrate = '64k',
  ffmpeg = 'ffmpeg'
}: {
  input: string
  output: string
  metadataFile?: string
  bitrate?: string
  /** Path to the binary; resolved by the caller, which may download one. */
  ffmpeg?: string
}): Promise<void> {
  const args = ['-y', '-i', input]

  if (metadataFile) {
    args.push('-i', metadataFile, '-map_metadata', '1', '-map_chapters', '1')
  }

  args.push(
    '-map',
    '0:a',
    '-c:a',
    'aac',
    '-b:a',
    bitrate,
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    output
  )

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] })

    let stderr = ''
    child.stderr.on('data', (data) => (stderr += data))

    child.on('error', (err: NodeJS.ErrnoException) => {
      reject(err.code === 'ENOENT' ? new FfmpegMissingError() : err)
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(-800)}`))
      }
    })
  })
}
