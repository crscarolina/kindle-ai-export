import { describe, expect, test } from 'vitest'

import {
  FFMPEG_RELEASES,
  ffmpegCachePath,
  releaseForArch,
  verifyChecksum
} from './ffmpeg-install'

describe('releaseForArch', () => {
  test('resolves Apple Silicon', () => {
    expect(releaseForArch('arm64').url).toContain('darwin-arm64')
  })

  test('resolves Intel', () => {
    expect(releaseForArch('x64').url).toContain('darwin-x64')
  })

  test('refuses an architecture with no pinned build', () => {
    // Better an explicit error than downloading a binary that cannot run.
    expect(() => releaseForArch('ppc64' as never)).toThrow(/ppc64/)
  })

  test('every pinned release carries a checksum', () => {
    // A download nobody verifies is a supply-chain hole, so the shape of the
    // table is itself worth asserting.
    for (const [arch, release] of Object.entries(FFMPEG_RELEASES)) {
      expect(release.sha256, arch).toMatch(/^[\da-f]{64}$/)
      expect(release.url, arch).toMatch(/^https:\/\//)
    }
  })

  test('the two builds are different binaries', () => {
    expect(FFMPEG_RELEASES.arm64.sha256).not.toBe(FFMPEG_RELEASES.x64.sha256)
  })
})

describe('verifyChecksum', () => {
  const payload = Buffer.from('hello')
  // sha256("hello")
  const hash =
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

  test('accepts a matching payload', () => {
    expect(() => verifyChecksum(payload, hash)).not.toThrow()
  })

  test('rejects a payload that does not match', () => {
    expect(() => verifyChecksum(Buffer.from('hell0'), hash)).toThrow(
      /checksum/i
    )
  })

  test('names both hashes so a version bump is obvious', () => {
    // The usual cause is the upstream release being re-cut, not an attack.
    expect(() => verifyChecksum(Buffer.from('nope'), hash)).toThrow(/2cf24dba/)
  })

  test('is case-insensitive about the expected hash', () => {
    expect(() => verifyChecksum(payload, hash.toUpperCase())).not.toThrow()
  })

  test('rejects an empty download', () => {
    expect(() => verifyChecksum(Buffer.alloc(0), hash)).toThrow(/checksum/i)
  })
})

describe('ffmpegCachePath', () => {
  test('lives beside the app support data, not in the repo', () => {
    expect(ffmpegCachePath('/Users/reader', 'arm64')).toBe(
      '/Users/reader/Library/Application Support/kindle-ai-export/bin/ffmpeg-arm64'
    )
  })

  test('keeps architectures apart', () => {
    // An x64 binary cached over an arm64 one would fail confusingly.
    expect(ffmpegCachePath('/h', 'arm64')).not.toBe(
      ffmpegCachePath('/h', 'x64')
    )
  })
})
