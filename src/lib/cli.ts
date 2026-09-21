import path from 'node:path'

import { parseAsin } from './asin'
import { sessionDir } from './paths'
import { DEFAULT_VOICE, findVoice, VOICES } from './voices'

/** Resolved options for listing the reader's Kindle library. */
export type LibraryCliOptions = {
  /** Chrome profile directory. Shared across every book.  */
  userDataDir: string
  /** Where to write the library listing, if the caller chose a destination. */
  outFile: string | undefined
  /** Emit NDJSON progress events instead of prose. */
  json: boolean
  /** Return at most this many books. */
  limit: number | undefined
  /** Restrict to these books, rather than the whole library. */
  asins: string[] | undefined
  /** Restrict to these Kokoro voices, rather than all of them. */
  voiceIds: string[] | undefined
  /** Narration speed, 1 being the voice's natural pace. */
  speed: number
  /** Redo work that has already been completed. */
  force: boolean
}

/** Fully resolved options for a pipeline script. */
export type CliOptions = {
  asin: string
  /** Root directory holding every book's working set. */
  workDir: string
  /** This book's working set: `<workDir>/<asin>`. */
  bookDir: string
  /** Chrome profile directory. Shared across books when the app passes one. */
  userDataDir: string
  /** Where to write this step's artifact, if the caller chose a destination. */
  outFile: string | undefined
  /** Emit NDJSON progress events instead of prose. */
  json: boolean
  /** Redo work that has already been completed. */
  force: boolean
  /** Process at most this many pages. Useful for previewing a long book. */
  limit: number | undefined
  /** Kokoro voice id for narration. */
  voice: string
  /** Narration speed, 1 being the voice's natural pace. */
  speed: number
}

const VALUE_FLAGS = new Set([
  '--asin',
  '--work-dir',
  '--user-data-dir',
  '--out-file',
  '--limit',
  '--voice',
  '--speed'
])
const BOOLEAN_FLAGS = new Set(['--json', '--force'])

function tokenize(argv: string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>()

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg : arg.slice(0, eq)

    if (BOOLEAN_FLAGS.has(name)) {
      flags.set(name, true)
      continue
    }

    if (!VALUE_FLAGS.has(name)) {
      throw new Error(`Unknown argument: ${arg}`)
    }

    if (eq !== -1) {
      flags.set(name, arg.slice(eq + 1))
      continue
    }

    // Don't let a value flag swallow the flag that follows it.
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`Missing value for ${name}`)
    }

    flags.set(name, next)
    i++
  }

  return flags
}

/**
 * Resolve options for the library listing, which has no book to key paths
 * off and so defaults to the shared account session.
 */
export function parseLibraryCliArgs(
  argv: string[],
  env: Record<string, string | undefined>
): LibraryCliOptions {
  const flags = tokenize(argv)
  const value = (name: string): string | undefined => {
    const flag = flags.get(name)
    return typeof flag === 'string' ? flag : undefined
  }

  const explicitProfile = value('--user-data-dir')
  if (!explicitProfile && !env.HOME) {
    throw new Error('HOME is unset: pass --user-data-dir explicitly')
  }

  return {
    userDataDir: explicitProfile ?? sessionDir(env.HOME!),
    outFile: value('--out-file'),
    json: flags.get('--json') === true,
    limit: parseLimit(value('--limit')),
    asins: parseAsinList(value('--asin')),
    voiceIds: parseVoiceList(value('--voice')),
    speed: parseSpeed(value('--speed') ?? env.KOKORO_SPEED),
    force: flags.get('--force') === true || env.FORCE === 'true'
  }
}

/**
 * Parse a comma-separated book filter.
 *
 * An unparseable entry throws rather than being dropped: silently filtering
 * down to nothing would look like "this book has no pagination" instead of
 * "you typed the id wrong".
 */
function parseAsinList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) {
    return
  }

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const asin = parseAsin(entry)
      if (!asin) {
        throw new Error(`Invalid ASIN: ${entry}`)
      }
      return asin
    })
}

/**
 * Resolve a voice by id or by name.
 *
 * Accepts the name shown in the picker as well as the id, since that is what
 * someone reading the catalogue is likely to type.
 */
function parseVoice(raw: string | undefined): string {
  if (!raw) {
    return DEFAULT_VOICE
  }

  const wanted = raw.trim().toLowerCase()
  const voice =
    findVoice(wanted) ??
    VOICES.find((candidate) => candidate.name.toLowerCase() === wanted)

  if (!voice) {
    const examples = VOICES.slice(0, 4)
      .map((candidate) => candidate.id)
      .join(', ')
    throw new Error(
      `Unknown voice: ${raw}. Try one of ${examples}, ... (see src/lib/voices.ts for all ${VOICES.length})`
    )
  }

  return voice.id
}

/**
 * Parse a comma-separated voice filter.
 *
 * Each entry goes through the same resolution as `--voice` for narration, so
 * names and ids both work and a typo is rejected rather than silently
 * matching nothing.
 */
/** The range over which Kokoro still sounds like speech. */
const MIN_SPEED = 0.5
const MAX_SPEED = 2

function parseSpeed(raw: string | undefined): number {
  if (!raw) {
    return 1
  }

  const speed = Number(raw)
  if (!Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED) {
    throw new Error(
      `Invalid --speed: ${raw} (expected ${MIN_SPEED} to ${MAX_SPEED}, where 1 is the voice's natural pace)`
    )
  }

  return speed
}

function parseVoiceList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) {
    return
  }

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => parseVoice(entry))
}

function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return
  }

  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid --limit: ${raw} (expected a positive integer)`)
  }

  return limit
}

/**
 * Resolve options from argv, falling back to environment variables and then to
 * defaults.
 *
 * Defaults are deliberately unchanged from the pre-flag behaviour (`./out`,
 * a per-book Chrome profile) so running a script from a terminal works exactly
 * as it always has. The macOS app passes every path explicitly.
 */
export function parseCliArgs(
  argv: string[],
  env: Record<string, string | undefined>
): CliOptions {
  const flags = tokenize(argv)

  const value = (name: string): string | undefined => {
    const flag = flags.get(name)
    return typeof flag === 'string' ? flag : undefined
  }

  const rawAsin = value('--asin') ?? env.ASIN
  if (!rawAsin) {
    throw new Error('Missing ASIN: pass --asin <asin-or-url> or set ASIN')
  }

  const asin = parseAsin(rawAsin)
  if (!asin) {
    throw new Error(`Invalid ASIN: ${rawAsin}`)
  }

  const workDir = value('--work-dir') ?? 'out'
  const bookDir = path.join(workDir, asin)

  return {
    asin,
    workDir,
    bookDir,
    userDataDir: value('--user-data-dir') ?? path.join(bookDir, 'data'),
    outFile: value('--out-file'),
    json: flags.get('--json') === true,
    force: flags.get('--force') === true || env.FORCE === 'true',
    limit: parseLimit(value('--limit')),
    voice: parseVoice(value('--voice') ?? env.KOKORO_VOICE),
    speed: parseSpeed(value('--speed') ?? env.KOKORO_SPEED)
  }
}
