/**
 * Split text into pieces small enough to narrate one at a time.
 *
 * Splitting happens at sentence boundaries so the synthesised prosody doesn't
 * break mid-clause. A sentence longer than the budget is emitted whole rather
 * than cut: a clipped sentence would be audible, and silently dropping the
 * remainder would lose the text.
 */
export function splitForNarration(text: string, maxChars: number): string[] {
  const sentences = text
    .split(/(?<=[!.?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  const pieces: string[] = []
  let current = ''

  for (const sentence of sentences) {
    if (!current) {
      current = sentence
      continue
    }

    if (current.length + 1 + sentence.length <= maxChars) {
      current += ` ${sentence}`
    } else {
      pieces.push(current)
      current = sentence
    }
  }

  if (current) {
    pieces.push(current)
  }

  return pieces
}
