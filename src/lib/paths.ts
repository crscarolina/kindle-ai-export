import path from 'node:path'

const APP_DIR_NAME = 'kindle-ai-export'

/** Root directory for everything the macOS app stores on disk. */
export function appSupportDir(home: string): string {
  return path.join(home, 'Library', 'Application Support', APP_DIR_NAME)
}

/**
 * The shared Chrome profile.
 *
 * One profile for the whole account, rather than one per book: the reader
 * signs in once instead of once per title, and the profile stops
 * re-accumulating hundreds of megabytes per export.
 */
export function sessionDir(home: string): string {
  return path.join(appSupportDir(home), 'session')
}

/** A single book's working set: page screenshots, metadata, transcription. */
export function bookWorkDir(home: string, asin: string): string {
  return path.join(appSupportDir(home), asin)
}
