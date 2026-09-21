import path from 'node:path'

import { fileExists } from '../utils'

/**
 * Locate the content to export.
 *
 * The Claude cleanup pass writes alongside the raw transcription rather than
 * over it, so the original OCR output stays available and the pass can be
 * re-run or skipped. Exports prefer the cleaned version when it is there.
 */
export async function resolveContentPath(bookDir: string): Promise<string> {
  const cleaned = path.join(bookDir, 'content.clean.json')
  return (await fileExists(cleaned))
    ? cleaned
    : path.join(bookDir, 'content.json')
}
