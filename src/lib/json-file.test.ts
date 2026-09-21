import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { readJsonFile, tryReadJsonFile } from '../utils'

const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kindle-json-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true }))
  )
})

describe('tryReadJsonFile', () => {
  test('reads a file that exists', async () => {
    const dir = await tempDir()
    await fs.writeFile(path.join(dir, 'a.json'), '{"ok":true}')
    expect(await tryReadJsonFile(path.join(dir, 'a.json'))).toEqual({
      ok: true
    })
  })

  test('returns undefined for a missing file rather than rejecting', async () => {
    // The `try` wrapped a promise that was returned without being awaited, so
    // the catch never fired and callers got a rejection instead of undefined.
    const dir = await tempDir()
    await expect(
      tryReadJsonFile(path.join(dir, 'missing.json'))
    ).resolves.toBeUndefined()
  })

  test('returns undefined for malformed JSON', async () => {
    const dir = await tempDir()
    await fs.writeFile(path.join(dir, 'bad.json'), '{not json')
    await expect(
      tryReadJsonFile(path.join(dir, 'bad.json'))
    ).resolves.toBeUndefined()
  })

  test('returns undefined for a directory', async () => {
    const dir = await tempDir()
    await expect(tryReadJsonFile(dir)).resolves.toBeUndefined()
  })
})

describe('readJsonFile', () => {
  test('still rejects for a missing file', async () => {
    const dir = await tempDir()
    await expect(readJsonFile(path.join(dir, 'missing.json'))).rejects.toThrow()
  })
})
