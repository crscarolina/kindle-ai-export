import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { resolveContentPath } from './content'

const dirs: string[] = []

async function tempBookDir(files: string[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kindle-content-'))
  dirs.push(dir)
  for (const file of files) {
    await fs.writeFile(path.join(dir, file), '[]')
  }
  return dir
}

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true }))
  )
})

describe('resolveContentPath', () => {
  test('prefers the cleaned content when it exists', async () => {
    const dir = await tempBookDir(['content.json', 'content.clean.json'])
    expect(await resolveContentPath(dir)).toBe(
      path.join(dir, 'content.clean.json')
    )
  })

  test('falls back to the raw content', async () => {
    const dir = await tempBookDir(['content.json'])
    expect(await resolveContentPath(dir)).toBe(path.join(dir, 'content.json'))
  })

  test('returns the raw path even when nothing exists, so callers report a clear error', async () => {
    const dir = await tempBookDir([])
    expect(await resolveContentPath(dir)).toBe(path.join(dir, 'content.json'))
  })
})
