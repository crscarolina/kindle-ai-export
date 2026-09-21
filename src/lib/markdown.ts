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

  for (let i = 0; i < toc.length; i++) {
    const tocItem = toc[i]!
    if (tocItem.page === undefined) continue

    const nextTocItem = toc[i + 1]
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
