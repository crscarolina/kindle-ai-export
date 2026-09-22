import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

import { appSupportDir } from './paths'

/**
 * Where ffmpeg comes from when the machine has none.
 *
 * Fetched at first use rather than shipped in the app. ffmpeg is GPL, and
 * bundling it would put this project's MIT licence in question; a binary the
 * user's own machine downloads is one they obtained, exactly as if they had
 * run `brew install ffmpeg`.
 *
 * Hashes are pinned here rather than read from the server that serves the
 * download -- a checksum fetched from the same host proves nothing if that
 * host is compromised. Upgrading ffmpeg is therefore a code change, which is
 * the point.
 */
export const FFMPEG_RELEASES = {
  arm64: {
    url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz',
    sha256: '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa'
  },
  x64: {
    url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-x64.gz',
    sha256: '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106'
  }
} as const

export type FfmpegArch = keyof typeof FFMPEG_RELEASES

export function releaseForArch(arch: FfmpegArch) {
  const release = FFMPEG_RELEASES[arch]
  if (!release) {
    throw new Error(
      `no pinned ffmpeg build for ${arch}; install ffmpeg yourself with \`brew install ffmpeg\``
    )
  }

  return release
}

export function ffmpegCachePath(home: string, arch: FfmpegArch): string {
  return path.join(appSupportDir(home), 'bin', `ffmpeg-${arch}`)
}

/** Throw unless the payload hashes to what was pinned. */
export function verifyChecksum(payload: Buffer, expected: string): void {
  const actual = createHash('sha256').update(payload).digest('hex')
  if (actual !== expected.toLowerCase()) {
    throw new Error(
      `ffmpeg download failed its checksum: expected ${expected.toLowerCase()}, got ${actual}`
    )
  }
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await fs.access(file, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Whether a binary actually runs, rather than merely existing. */
async function runs(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(file, ['-version'], { stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

/**
 * Find ffmpeg, downloading one if the machine has none.
 *
 * A system ffmpeg always wins: it is the user's choice, probably newer, and
 * downloading over it would be presumptuous.
 */
export async function resolveFfmpeg({
  home,
  arch,
  onProgress = () => {}
}: {
  home: string
  arch: FfmpegArch
  onProgress?: (message: string) => void
}): Promise<string> {
  if (await runs('ffmpeg')) {
    return 'ffmpeg'
  }

  const cached = ffmpegCachePath(home, arch)
  if ((await isExecutable(cached)) && (await runs(cached))) {
    return cached
  }

  const release = releaseForArch(arch)
  onProgress(`downloading ffmpeg for ${arch} (about 24MB, once)`)

  const response = await fetch(release.url)
  if (!response.ok) {
    throw new Error(
      `could not download ffmpeg (${response.status} from ${release.url}); install it with \`brew install ffmpeg\``
    )
  }

  const archive = Buffer.from(await response.arrayBuffer())
  verifyChecksum(archive, release.sha256)

  await fs.mkdir(path.dirname(cached), { recursive: true })
  // Write beside the target and move into place, so an interrupted download
  // cannot leave a half-written binary that looks installed.
  const partial = `${cached}.partial`
  await fs.writeFile(partial, gunzipSync(archive))
  await fs.chmod(partial, 0o755)

  // Downloads are quarantined, and a quarantined binary cannot be executed
  // without the user clearing it by hand.
  await new Promise<void>((resolve) => {
    const child = spawn('xattr', ['-d', 'com.apple.quarantine', partial], {
      stdio: 'ignore'
    })
    child.on('error', () => resolve())
    child.on('close', () => resolve())
  })

  await fs.rename(partial, cached)

  if (!(await runs(cached))) {
    await fs.rm(cached, { force: true })
    throw new Error(
      'the downloaded ffmpeg will not run; install it with `brew install ffmpeg`'
    )
  }

  onProgress(`ffmpeg installed at ${cached}`)
  return cached
}
