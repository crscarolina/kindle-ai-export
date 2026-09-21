/**
 * Splitting the cleanup across subagents inside one `claude` session.
 *
 * Spawning the CLI once per batch pays its startup -- measured at ~4.3s --
 * seventy-odd times for a novel. Driving the whole job from a single session
 * pays it once, and Claude Code's own subagents provide the parallelism.
 *
 * Batches are handed over as files rather than through the prompt: a novel is
 * roughly a million characters, which would not fit in the orchestrator's
 * context, and files also make it verifiable afterwards exactly which batches
 * came back.
 */

const BATCH_FILE_REGEX = /^(\d{4})\.txt$/

/** Zero-padded so the files sort in the order they should be processed. */
export function batchFileName(index: number): string {
  return `${String(index).padStart(4, '0')}.txt`
}

export function parseBatchFileName(name: string): number | undefined {
  const match = name.match(BATCH_FILE_REGEX)
  return match ? Number(match[1]) : undefined
}

/**
 * Which batches never came back.
 *
 * The orchestrator is a language model driving a long loop, so "it said it
 * finished" is not evidence. The files on disk are, and anything absent is
 * retried individually rather than quietly keeping the original text.
 */
export function missingBatchIndices(
  total: number,
  presentFileNames: string[]
): number[] {
  const present = new Set(
    presentFileNames
      .map((name) => parseBatchFileName(name))
      .filter((index): index is number => index !== undefined)
  )

  const missing: number[] = []
  for (let index = 0; index < total; index++) {
    if (!present.has(index)) {
      missing.push(index)
    }
  }

  return missing
}

/** The instruction given to the single orchestrating session. */
export function buildOrchestratorPrompt({
  inDir,
  outDir,
  total,
  concurrency
}: {
  inDir: string
  outDir: string
  total: number
  concurrency: number
}): string {
  return `You are cleaning up OCR'd book text. There are ${total} batch files to process.

Input files:  ${inDir}/0000.txt through ${batchFileName(total - 1)}
Output files: ${outDir}/ (same filename as the input)

Work through every input file using the Task tool, running ${concurrency} subagents at a time. Do not process them yourself and do not read the batch files into your own context -- they are large, and there are ${total} of them. Your job is only to dispatch and keep going until all ${total} outputs exist.

Give each subagent exactly this instruction, substituting the filename:

---
Read ${inDir}/<FILE>. It contains book text split into blocks, each introduced by a line of the form <<<CHUNK n>>>.

Rewrite the text of each block:
- Rejoin lines that OCR wrapped mid-sentence, and restore the paragraph breaks between them. This is the most important part.
- Remove running heads, page numbers and stray footnote markers.
- Fix obvious OCR misreadings (for example "l'd" for "I'd", broken em-dashes, missing quotation marks).

Never summarise, abridge, rewrite or censor. Preserve the author's wording, spelling and punctuation exactly. Return every chunk you were given, in order.

Write the result to ${outDir}/<FILE>, using exactly the same <<<CHUNK n>>> delimiters and the same chunk numbers. Write nothing else to that file -- no preamble, no commentary. Use the Write tool; do not print the text back to me.
---

Report only a one-line count when every batch has an output file. Do not paste any book text into your reply.`
}
