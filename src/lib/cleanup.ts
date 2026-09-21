import type { ContentChunk } from '../types'

const DELIMITER = /^<<<CHUNK (\d+)>>>$/gm

/**
 * A cleaned chunk shorter than this fraction of the original is treated as a
 * truncated response and discarded. Genuine cleanup removes page furniture
 * and footnote markers, which is a small fraction of a page.
 */
const MIN_LENGTH_RATIO = 0.5

export const CLEANUP_SYSTEM_PROMPT = `You prepare OCR'd book text for reading aloud and for publication as Markdown.

For each chunk:
- Repair paragraph breaks and whitespace that OCR mangled.
- Remove running heads, page numbers, and stray footnote markers.
- Expand abbreviations a narrator would stumble over ("Ch. 3" -> "Chapter Three", "Dr." -> "Doctor").
- Fix obvious OCR misreadings.

Never summarise, abridge, rewrite, or censor. Preserve the author's wording, spelling and punctuation. Return every chunk you were given, in order.`

/** Build the prompt for one batch of chunks. */
export function buildCleanupPrompt(chunks: ContentChunk[]): string {
  const body = chunks
    .map((chunk) => `<<<CHUNK ${chunk.index}>>>\n${chunk.text}`)
    .join('\n')

  return `Clean the following book text. Return it using exactly the same <<<CHUNK n>>> delimiters, with nothing else before or after.

${body}`
}

/**
 * Read the delimited chunks back out of a response.
 *
 * Tolerant of a preamble before the first delimiter, since models often
 * introduce their output.
 */
export function parseCleanupResponse(raw: string): Map<number, string> {
  const cleaned = new Map<number, string>()
  if (!raw) {
    return cleaned
  }

  const matches = [...raw.matchAll(DELIMITER)]

  for (const [i, match] of matches.entries()) {
    const start = match.index! + match[0].length
    const end = matches[i + 1]?.index ?? raw.length
    cleaned.set(Number(match[1]), raw.slice(start, end).trim())
  }

  return cleaned
}

/**
 * Merge cleaned text back into the chunks.
 *
 * Anything missing, empty, or drastically shorter than the original keeps its
 * original text: a cleanup pass must never be able to silently delete the
 * book it was meant to tidy.
 */
export function applyCleanup(
  chunks: ContentChunk[],
  cleaned: Map<number, string>
): ContentChunk[] {
  return chunks.map((chunk) => {
    const text = cleaned.get(chunk.index)
    if (!text || text.length < chunk.text.length * MIN_LENGTH_RATIO) {
      return chunk
    }

    return { ...chunk, text }
  })
}

/**
 * Group chunks into batches under a character budget.
 *
 * A chunk larger than the whole budget still gets its own batch: splitting it
 * further would cut mid-page, and dropping it would lose text.
 */
export function batchChunks(
  chunks: ContentChunk[],
  maxChars: number
): ContentChunk[][] {
  const batches: ContentChunk[][] = []
  let batch: ContentChunk[] = []
  let size = 0

  for (const chunk of chunks) {
    if (batch.length && size + chunk.text.length > maxChars) {
      batches.push(batch)
      batch = []
      size = 0
    }

    batch.push(chunk)
    size += chunk.text.length
  }

  if (batch.length) {
    batches.push(batch)
  }

  return batches
}
