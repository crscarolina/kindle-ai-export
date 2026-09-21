import 'dotenv/config'

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'

import pMap from 'p-map'

import type { BookMetadata, ContentChunk, TocItem } from './types'
import { assert, fileExists, getEnv, readJsonFile } from './utils'

const ocrSourcePath = path.join('src', 'ocr-macos.swift')
const ocrBinaryPath = path.join('out', '.bin', 'ocr-macos')

// macOS ships a system word list which we use to repair chapter drop caps
const systemWordsPath = '/usr/share/dict/words'

/**
 * Compiles the Vision-based OCR helper, reusing the cached binary if it's
 * already up-to-date.
 */
async function buildOcrBinary(): Promise<string> {
  const [sourceStat, binaryStat] = await Promise.all([
    fs.stat(ocrSourcePath),
    fs.stat(ocrBinaryPath).catch(() => undefined)
  ])

  if (binaryStat && binaryStat.mtimeMs >= sourceStat.mtimeMs) {
    return ocrBinaryPath
  }

  await fs.mkdir(path.dirname(ocrBinaryPath), { recursive: true })
  const child = spawn('swiftc', ['-O', '-o', ocrBinaryPath, ocrSourcePath], {
    stdio: ['ignore', 'inherit', 'inherit']
  })
  const [exitCode] = await once(child, 'close')
  assert(exitCode === 0, `failed to compile ${ocrSourcePath}`)

  return ocrBinaryPath
}

/** Transcribes a PNG image using macOS's built-in Vision text recognition. */
async function ocrImage(
  binaryPath: string,
  imagePath: string
): Promise<string> {
  const child = spawn(binaryPath, ['--no-language-correction', imagePath], {
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk))
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk))

  const [exitCode] = await once(child, 'close')
  if (exitCode !== 0) {
    throw new Error(
      `OCR failed for ${imagePath} (exit code ${exitCode}): ${stderr.trim()}`
    )
  }

  return stdout
}

/** Returns true if the first word of `line` appears in the system word list. */
function isKnownFirstWord(line: string, words: Set<string> | undefined) {
  const word = line.split(/\s+/)[0]?.replaceAll(/[^A-Za-z]/g, '')
  return !!word && !!words?.has(word.toLowerCase())
}

/**
 * Vision occasionally drops the space after a sentence ends (e.g.
 * `to do it.I could not`). This book contains no initials of the form
 * `J.R.`, so only lowercase-to-uppercase transitions are touched.
 */
function fixMissingSentenceSpaces(text: string): string {
  return text.replaceAll(/([a-z][.!?])([A-Z])/g, '$1 $2')
}

/**
 * Vision frequently misreads a capital `I` standing alone as `|`, `1`, or a
 * lowercase `l` (e.g. `1 had known`). None of those are valid English words
 * on their own, so it is safe to convert them back.
 */
function fixMisreadCapitalI(text: string): string {
  return text.replaceAll(/(^|\s)[|1l](?=\s|$)/gm, '$1I')
}

/**
 * Chapters start with a decorative drop cap which Vision reads as its own
 * line, often followed by a garbled first character on the next line (e.g.
 * `T` + `Jhree children` for `Three children`). We merge the two lines back
 * together, using the system word list to decide whether that stray leading
 * character should be dropped.
 */
function fixDropCap(text: string, words: Set<string> | undefined): string {
  const lines = text.split('\n')

  for (let i = 0; i < lines.length - 1; i++) {
    const dropCap = lines[i]!.trim()
    if (!/^[A-Z]$/.test(dropCap)) continue

    const next = lines[i + 1]!
    const withStrayChar = dropCap + next
    const withoutStrayChar = dropCap + next.slice(1)

    // Default to keeping the character when neither option is a known word
    const merged = isKnownFirstWord(withStrayChar, words)
      ? withStrayChar
      : isKnownFirstWord(withoutStrayChar, words)
        ? withoutStrayChar
        : withStrayChar

    lines.splice(i, 2, merged)
  }

  return lines.join('\n')
}

async function main() {
  const asin = getEnv('ASIN')
  assert(asin, 'ASIN is required')

  const outDir = path.join('out', asin)
  const metadata = await readJsonFile<BookMetadata>(
    path.join(outDir, 'metadata.json')
  )
  assert(metadata.pages?.length, 'no page screenshots found')
  assert(metadata.toc?.length, 'invalid book metadata: missing toc')

  const pageToTocItemMap = metadata.toc.reduce(
    (acc, tocItem) => {
      if (tocItem.page !== undefined) {
        acc[tocItem.page] = tocItem
      }
      return acc
    },
    {} as Record<number, TocItem>
  )

  const ocrBinary = await buildOcrBinary()
  const words = (await fileExists(systemWordsPath))
    ? new Set(
        (await fs.readFile(systemWordsPath, 'utf8'))
          .split('\n')
          .map((word) => word.toLowerCase())
      )
    : undefined

  const content: ContentChunk[] = (
    await pMap(
      metadata.pages,
      async (pageChunk, pageChunkIndex) => {
        const { screenshot, index, page } = pageChunk

        try {
          const rawText = await ocrImage(ocrBinary, screenshot)

          let text = fixMissingSentenceSpaces(
            fixMisreadCapitalI(fixDropCap(rawText, words))
          )
            .replace(/^\s*\d+\s*$\n+/m, '')
            .replaceAll(/^\s*/gm, '')
            .replaceAll(/\s*$/gm, '')

          assert(text, `no text found for page ${page} (${screenshot})`)

          const tocItem = pageToTocItemMap[page]
          const prevPageChunk = metadata.pages[pageChunkIndex - 1]
          if (prevPageChunk && prevPageChunk.page !== page && tocItem) {
            text = text.replace(
              // eslint-disable-next-line security/detect-non-literal-regexp
              new RegExp(`^${tocItem.label}\\s*`, 'i'),
              ''
            )
          }

          // Drop caps we couldn't repair leave a garbled first word behind,
          // so flag chapter pages which still look suspicious
          const firstWord = text.split(/\s+/)[0]?.replaceAll(/[^A-Za-z]/g, '')
          if (
            tocItem &&
            words &&
            firstWord &&
            !words.has(firstWord.toLowerCase())
          ) {
            console.warn('check drop cap manually...', {
              index,
              page,
              firstWord,
              screenshot
            })
          }

          const result: ContentChunk = {
            index,
            page,
            text,
            screenshot
          }
          console.log(result)

          return result
        } catch (err) {
          console.error(`error processing image ${index} (${screenshot})`, err)
        }
      },
      { concurrency: 8 }
    )
  ).filter(Boolean)

  await fs.writeFile(
    path.join(outDir, 'content.json'),
    JSON.stringify(content, null, 2)
  )
  console.log(JSON.stringify(content, null, 2))
}

await main()
