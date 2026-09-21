import { describe, expect, test } from 'vitest'

import type { BookMetadata, ContentChunk } from '../types'
import { renderBookMarkdown, tocSlug } from './markdown'

function meta(toc: BookMetadata['toc']): BookMetadata {
  return {
    meta: { title: 'Revelation Space', authorList: ['Alastair Reynolds'] },
    toc
  } as BookMetadata
}

function chunk(page: number, text: string): ContentChunk {
  return { index: page, page, text, screenshot: '' }
}

describe('tocSlug', () => {
  test('lower-cases and hyphenates', () => {
    expect(tocSlug('Chapter One')).toBe('chapter-one')
  })

  test('collapses runs of punctuation into a single hyphen', () => {
    expect(tocSlug('Chapter 1: The Beginning!')).toBe(
      'chapter-1-the-beginning-'
    )
  })

  test('leaves an already-clean label alone', () => {
    expect(tocSlug('prologue')).toBe('prologue')
  })
})

describe('renderBookMarkdown', () => {
  const toc = [
    { label: 'Chapter One', positionId: 0, page: 1, depth: 0 },
    { label: 'Chapter Two', positionId: 1, page: 3, depth: 0 }
  ] as BookMetadata['toc']

  const content = [
    chunk(1, 'First page.'),
    chunk(2, 'Second page.'),
    chunk(3, 'Third page.')
  ]

  test('opens with the title and author', () => {
    const md = renderBookMarkdown({ metadata: meta(toc), content })
    expect(md.startsWith('# Revelation Space\n\n> By Alastair Reynolds')).toBe(
      true
    )
  })

  test('includes a table of contents linking each chapter', () => {
    const md = renderBookMarkdown({ metadata: meta(toc), content })
    expect(md).toContain('- [Chapter One](#chapter-one)')
    expect(md).toContain('- [Chapter Two](#chapter-two)')
  })

  test('indents nested toc entries by depth', () => {
    const nested = [
      { label: 'Part One', positionId: 0, page: 1, depth: 0 },
      { label: 'Chapter One', positionId: 1, page: 2, depth: 1 }
    ] as BookMetadata['toc']

    const md = renderBookMarkdown({ metadata: meta(nested), content })
    expect(md).toContain('  - [Chapter One](#chapter-one)')
  })

  test('renders headings two levels below the toc depth', () => {
    const nested = [
      { label: 'Part One', positionId: 0, page: 1, depth: 0 },
      { label: 'Chapter One', positionId: 1, page: 2, depth: 1 }
    ] as BookMetadata['toc']

    const md = renderBookMarkdown({ metadata: meta(nested), content })
    expect(md).toContain('## Part One')
    expect(md).toContain('### Chapter One')
  })

  test('assigns each chunk to the chapter that covers its page', () => {
    const md = renderBookMarkdown({ metadata: meta(toc), content })
    // [0] is the preamble and [1] is the table of contents.
    const sections = md.split(/^## /m)
    const one = sections[2] ?? ''
    const two = sections[3] ?? ''

    expect(one).toContain('First page.')
    expect(one).toContain('Second page.')
    expect(one).not.toContain('Third page.')
    expect(two).toContain('Third page.')
  })

  test('joins chunks within a chapter with a space', () => {
    const md = renderBookMarkdown({ metadata: meta(toc), content })
    expect(md).toContain('First page. Second page.')
  })

  test('turns single newlines into blank lines so paragraphs render', () => {
    const md = renderBookMarkdown({
      metadata: meta([toc[0]!]),
      content: [chunk(1, 'One.\nTwo.')]
    })
    expect(md).toContain('One.\n\nTwo.')
  })

  test('skips toc entries that have no page', () => {
    const withUnpaged = [
      { label: 'Cover', positionId: 0, depth: 0 },
      { label: 'Chapter One', positionId: 1, page: 1, depth: 0 }
    ] as BookMetadata['toc']

    const md = renderBookMarkdown({ metadata: meta(withUnpaged), content })
    expect(md).not.toContain('Cover')
    expect(md).toContain('Chapter One')
  })

  test('joins multiple authors with a comma', () => {
    const metadata = meta(toc)
    metadata.meta.authorList = ['Ann Leckie', 'Alastair Reynolds']
    expect(renderBookMarkdown({ metadata, content })).toContain(
      '> By Ann Leckie, Alastair Reynolds'
    )
  })

  test('gives the last chapter every remaining chunk', () => {
    const md = renderBookMarkdown({
      metadata: meta(toc),
      content: [...content, chunk(4, 'Fourth page.'), chunk(5, 'Fifth page.')]
    })
    expect(md).toContain('Third page. Fourth page. Fifth page.')
  })
})
