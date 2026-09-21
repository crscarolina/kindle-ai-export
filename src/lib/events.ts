/** A step in the export pipeline. */
export type ExportStep =
  | 'extract'
  | 'transcribe'
  | 'clean'
  | 'markdown'
  | 'pdf'
  | 'audio'

/**
 * A structured progress event.
 *
 * The scripts emit these as NDJSON under `--json` so the macOS app can render
 * real progress instead of scraping prose, and so a stalled sign-in surfaces
 * as `session-expired` rather than a hung process.
 */
export type ExportEvent =
  | { event: 'step-start'; step: ExportStep }
  | { event: 'step-done'; step: ExportStep }
  | { event: 'page'; index: number; page: number; total: number }
  | { event: 'book-meta'; asin: string; title: string; authors: string[] }
  | { event: 'session-expired' }
  | { event: 'log'; message: string }
  | { event: 'error'; message: string }
  | { event: 'done'; outFile?: string }

/** Serialise an event as one NDJSON line. */
export function formatEvent(event: ExportEvent): string {
  return `${JSON.stringify(event)}\n`
}

/**
 * Decode one NDJSON line.
 *
 * Returns `undefined` for anything that isn't an event -- blank lines and the
 * prose the scripts still write to stderr both flow through the same pipe.
 */
export function parseEvent(line: string): ExportEvent | undefined {
  const trimmed = line?.trim()
  if (!trimmed) {
    return
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return
  }

  const { event } = parsed as { event?: unknown }
  return typeof event === 'string' ? (parsed as ExportEvent) : undefined
}

function formatHuman(event: ExportEvent): string {
  switch (event.event) {
    case 'step-start':
      return `\n--- ${event.step} ---`
    case 'step-done':
      return `--- ${event.step} done ---`
    case 'page':
      return `page ${event.page} (${event.index + 1}/${event.total})`
    case 'book-meta':
      return `${event.title} by ${event.authors.join(', ')} (${event.asin})`
    case 'session-expired':
      return 'Amazon session expired; sign in again'
    case 'error':
      return `error: ${event.message}`
    case 'done':
      return event.outFile ? `done: ${event.outFile}` : 'done'
    default:
      return event.message
  }
}

export type Reporter = {
  emit: (event: ExportEvent) => void
  log: (message: string) => void
}

/**
 * Build a reporter that emits NDJSON for the app, or readable prose for a
 * human at a terminal.
 */
export function createReporter({
  json,
  write = (chunk: string) => process.stdout.write(chunk)
}: {
  json: boolean
  write?: (chunk: string) => void
}): Reporter {
  const emit = (event: ExportEvent) => {
    write(json ? formatEvent(event) : `${formatHuman(event)}\n`)
  }

  return { emit, log: (message: string) => emit({ event: 'log', message }) }
}
