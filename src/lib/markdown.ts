import type { BookMetadata, ContentChunk, TocItem } from '../types'

/** Build the GitHub-style anchor a table-of-contents link points at. */
export function tocSlug(label: string): string {
  return label.toLowerCase().replaceAll(/[^\da-z]+/g, '-')
}

type TocSection = {
  tocItem: TocItem
  /** Index of the toc item in the original, unfiltered toc. */
  tocIndex: number
  chunks: ContentChunk[]
}

/**
 * Walk the toc, pairing each entry that has a page with the content chunks
 * that fall under it. Entries without a page (covers, front matter) are
 * skipped, and a trailing entry whose next sibling points past the extracted
 * content ends the book.
 */
function sectionize(toc: TocItem[], content: ContentChunk[]): TocSection[] {
  const sections: TocSection[] = []
  let index = 0

  // The table of contents describes the whole book, but a preview run only
  // extracts the opening pages. Entries past the end are dropped up front
  // rather than skipped inside the walk: the walk reads the *next* entry to
  // find where this one ends, so a skipped entry left in the list would still
  // be consulted, and the last real chapter would be discarded with it.
  //
  // Without any of this, an entry from deep in the book becomes the final
  // heading and absorbs the tail of the text -- a 50-page excerpt of
  // Wuthering Heights ended with "Chapter 34" set over chapter 5.
  const lastExtractedPage = content.reduce(
    (max, chunk) => Math.max(max, chunk.page),
    0
  )

  const entries = toc.filter(
    (item) => item.page !== undefined && item.page <= lastExtractedPage
  )

  for (const [i, tocItem] of entries.entries()) {
    const nextTocItem = entries[i + 1]
    const nextIndex = nextTocItem?.page
      ? content.findIndex((c) => c.page >= nextTocItem.page!)
      : content.length

    // `findIndex` returns -1 when the next chapter starts past everything we
    // extracted, which means this entry is beyond the end of the book.
    if (nextIndex < index) continue

    sections.push({
      tocItem,
      tocIndex: i,
      chunks: content.slice(index, nextIndex)
    })
    index = nextIndex
  }

  return sections
}

/** Render a book's metadata and transcribed content as Markdown. */
export function renderBookMarkdown({
  metadata,
  content
}: {
  metadata: BookMetadata
  content: ContentChunk[]
}): string {
  const title = metadata.meta.title
  const authors = metadata.meta.authorList
  const sections = sectionize(metadata.toc, content)

  const tableOfContents = sections
    .map(
      ({ tocItem }) =>
        `${'  '.repeat(tocItem.depth)}- [${tocItem.label}](#${tocSlug(tocItem.label)})`
    )
    .join('\n')

  let output = `# ${title}

> By ${authors.join(', ')}

---

## Table of Contents

${tableOfContents}

---`

  for (const { tocItem, chunks } of sections) {
    const text = chunks
      .map((chunk) => chunk.text)
      .join(' ')
      .replaceAll('\n', '\n\n')

    output += `

${'#'.repeat(tocItem.depth + 2)} ${tocItem.label}

${text}`
  }

  return output
}
