import { describe, expect, test } from 'vitest'

import { parseCliArgs, parseLibraryCliArgs } from './cli'

const asin = 'B0819W19WD'

describe('parseCliArgs', () => {
  test('reads the asin from a flag', () => {
    expect(parseCliArgs(['--asin', asin], {}).asin).toBe(asin)
  })

  test('accepts the --flag=value form', () => {
    expect(parseCliArgs([`--asin=${asin}`], {}).asin).toBe(asin)
  })

  test('accepts a Kindle reader URL as the asin', () => {
    expect(
      parseCliArgs(['--asin', `https://read.amazon.com/?asin=${asin}`], {}).asin
    ).toBe(asin)
  })

  test('falls back to the ASIN env var', () => {
    expect(parseCliArgs([], { ASIN: asin }).asin).toBe(asin)
  })

  test('prefers the flag over the env var', () => {
    expect(parseCliArgs(['--asin', asin], { ASIN: 'B000000000' }).asin).toBe(
      asin
    )
  })

  test('throws a helpful error when no asin is given', () => {
    expect(() => parseCliArgs([], {})).toThrow(/asin/i)
  })

  test('throws when the asin is unparseable', () => {
    expect(() => parseCliArgs(['--asin', 'not-an-asin'], {})).toThrow(/asin/i)
  })

  test('throws when a value flag is given no value', () => {
    expect(() => parseCliArgs(['--asin'], {})).toThrow(/--asin/)
  })

  test('throws on an unknown flag rather than ignoring it', () => {
    expect(() => parseCliArgs(['--asin', asin, '--nope'], {})).toThrow(/--nope/)
  })
})

describe('parseCliArgs paths', () => {
  test('defaults the work dir to ./out for CLI back-compat', () => {
    expect(parseCliArgs(['--asin', asin], {}).workDir).toBe('out')
  })

  test('honours an explicit --work-dir', () => {
    expect(
      parseCliArgs(['--asin', asin, '--work-dir', '/tmp/work'], {}).workDir
    ).toBe('/tmp/work')
  })

  test('nests the book dir under the work dir by asin', () => {
    expect(parseCliArgs(['--asin', asin], {}).bookDir).toBe(`out/${asin}`)
  })

  test('defaults the user data dir to the per-book data dir', () => {
    // Unchanged default keeps terminal use working exactly as before; the app
    // passes a shared profile explicitly.
    expect(parseCliArgs(['--asin', asin], {}).userDataDir).toBe(
      `out/${asin}/data`
    )
  })

  test('honours an explicit --user-data-dir', () => {
    expect(
      parseCliArgs(['--asin', asin, '--user-data-dir', '/shared/session'], {})
        .userDataDir
    ).toBe('/shared/session')
  })

  test('keeps the user data dir independent of a custom work dir', () => {
    const opts = parseCliArgs(
      ['--asin', asin, '--work-dir', '/w', '--user-data-dir', '/s'],
      {}
    )
    expect(opts.workDir).toBe('/w')
    expect(opts.userDataDir).toBe('/s')
  })

  test('derives the user data dir from a custom work dir when not given', () => {
    expect(
      parseCliArgs(['--asin', asin, '--work-dir', '/w'], {}).userDataDir
    ).toBe(`/w/${asin}/data`)
  })

  test('leaves outFile undefined unless asked for', () => {
    expect(parseCliArgs(['--asin', asin], {}).outFile).toBeUndefined()
  })

  test('honours an explicit --out-file', () => {
    expect(
      parseCliArgs(['--asin', asin, '--out-file', '~/Books/b.md'], {}).outFile
    ).toBe('~/Books/b.md')
  })
})

describe('parseCliArgs booleans', () => {
  test('json defaults to false', () => {
    expect(parseCliArgs(['--asin', asin], {}).json).toBe(false)
  })

  test('--json turns json mode on', () => {
    expect(parseCliArgs(['--asin', asin, '--json'], {}).json).toBe(true)
  })

  test('force defaults to false', () => {
    expect(parseCliArgs(['--asin', asin], {}).force).toBe(false)
  })

  test('--force turns force on', () => {
    expect(parseCliArgs(['--asin', asin, '--force'], {}).force).toBe(true)
  })

  test('reads force from the FORCE env var', () => {
    expect(parseCliArgs(['--asin', asin], { FORCE: 'true' }).force).toBe(true)
  })

  test('treats FORCE=false as false', () => {
    expect(parseCliArgs(['--asin', asin], { FORCE: 'false' }).force).toBe(false)
  })

  test('a boolean flag does not swallow the next argument', () => {
    const opts = parseCliArgs(['--json', '--asin', asin], {})
    expect(opts.json).toBe(true)
    expect(opts.asin).toBe(asin)
  })
})

describe('parseCliArgs limit', () => {
  test('limit is undefined by default', () => {
    expect(parseCliArgs(['--asin', asin], {}).limit).toBeUndefined()
  })

  test('reads a page limit', () => {
    expect(parseCliArgs(['--asin', asin, '--limit', '50'], {}).limit).toBe(50)
  })

  test('accepts the --limit=n form', () => {
    expect(parseCliArgs(['--asin', asin, '--limit=50'], {}).limit).toBe(50)
  })

  test('rejects a non-numeric limit', () => {
    expect(() => parseCliArgs(['--asin', asin, '--limit', 'lots'], {})).toThrow(
      /--limit/
    )
  })

  test('rejects a zero limit', () => {
    expect(() => parseCliArgs(['--asin', asin, '--limit', '0'], {})).toThrow(
      /--limit/
    )
  })

  test('rejects a negative limit', () => {
    expect(() => parseCliArgs(['--asin', asin, '--limit', '-5'], {})).toThrow(
      /--limit/
    )
  })

  test('rejects a fractional limit', () => {
    expect(() => parseCliArgs(['--asin', asin, '--limit', '1.5'], {})).toThrow(
      /--limit/
    )
  })
})

describe('parseLibraryCliArgs', () => {
  const env = { HOME: '/Users/reader' }

  test('does not require an asin', () => {
    expect(() => parseLibraryCliArgs([], env)).not.toThrow()
  })

  test('defaults to the shared session profile', () => {
    // The picker has no book to key a profile off, so it must use the
    // account-wide session.
    expect(parseLibraryCliArgs([], env).userDataDir).toBe(
      '/Users/reader/Library/Application Support/kindle-ai-export/session'
    )
  })

  test('honours an explicit --user-data-dir', () => {
    expect(
      parseLibraryCliArgs(['--user-data-dir', '/tmp/session'], env).userDataDir
    ).toBe('/tmp/session')
  })

  test('supports --json', () => {
    expect(parseLibraryCliArgs(['--json'], env).json).toBe(true)
  })

  test('supports --out-file', () => {
    expect(
      parseLibraryCliArgs(['--out-file', '/tmp/lib.json'], env).outFile
    ).toBe('/tmp/lib.json')
  })

  test('supports --limit', () => {
    expect(parseLibraryCliArgs(['--limit', '25'], env).limit).toBe(25)
  })

  test('rejects an unknown flag', () => {
    expect(() => parseLibraryCliArgs(['--nope'], env)).toThrow(/--nope/)
  })

  test('throws when HOME is unset and no profile is given', () => {
    expect(() => parseLibraryCliArgs([], {})).toThrow(/--user-data-dir/)
  })
})
