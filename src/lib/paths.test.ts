import { describe, expect, test } from 'vitest'

import { appSupportDir, bookWorkDir, sessionDir } from './paths'

const home = '/Users/reader'

describe('appSupportDir', () => {
  test('lives under the macOS Application Support directory', () => {
    expect(appSupportDir(home)).toBe(
      '/Users/reader/Library/Application Support/kindle-ai-export'
    )
  })

  test('tolerates a trailing slash on home', () => {
    expect(appSupportDir('/Users/reader/')).toBe(
      '/Users/reader/Library/Application Support/kindle-ai-export'
    )
  })
})

describe('sessionDir', () => {
  test('is a single shared Chrome profile, not per book', () => {
    expect(sessionDir(home)).toBe(
      '/Users/reader/Library/Application Support/kindle-ai-export/session'
    )
  })

  test('does not vary by book', () => {
    expect(sessionDir(home)).toBe(sessionDir(home))
  })
})

describe('bookWorkDir', () => {
  test('nests a book working set under the app support dir', () => {
    expect(bookWorkDir(home, 'B0819W19WD')).toBe(
      '/Users/reader/Library/Application Support/kindle-ai-export/B0819W19WD'
    )
  })

  test('keeps the working set separate from the shared session', () => {
    expect(bookWorkDir(home, 'B0819W19WD')).not.toBe(sessionDir(home))
  })
})
