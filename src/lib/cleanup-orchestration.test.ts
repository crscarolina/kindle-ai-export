import { describe, expect, test } from 'vitest'

import {
  batchFileName,
  buildOrchestratorPrompt,
  missingBatchIndices,
  parseBatchFileName
} from './cleanup-orchestration'

describe('batchFileName', () => {
  test('zero-pads so files sort in order', () => {
    expect(batchFileName(0)).toBe('0000.txt')
    expect(batchFileName(7)).toBe('0007.txt')
    expect(batchFileName(73)).toBe('0073.txt')
  })

  test('sorts lexically in numeric order', () => {
    const names = [0, 9, 10, 100].map(batchFileName)
    expect(names.toSorted()).toEqual(names)
  })

  test('round-trips through the parser', () => {
    for (const index of [0, 5, 42, 999]) {
      expect(parseBatchFileName(batchFileName(index))).toBe(index)
    }
  })
})

describe('parseBatchFileName', () => {
  test('ignores anything that is not a batch file', () => {
    expect(parseBatchFileName('.DS_Store')).toBeUndefined()
    expect(parseBatchFileName('notes.md')).toBeUndefined()
    expect(parseBatchFileName('12.json')).toBeUndefined()
  })

  test('ignores a partially written temp file', () => {
    expect(parseBatchFileName('0007.txt.tmp')).toBeUndefined()
  })
})

describe('missingBatchIndices', () => {
  test('finds nothing missing when every batch landed', () => {
    expect(
      missingBatchIndices(3, ['0000.txt', '0001.txt', '0002.txt'])
    ).toEqual([])
  })

  test('reports the batches the orchestrator did not produce', () => {
    // These are retried individually rather than silently kept as-is.
    expect(missingBatchIndices(4, ['0000.txt', '0002.txt'])).toEqual([1, 3])
  })

  test('reports every batch when nothing was produced', () => {
    expect(missingBatchIndices(3, [])).toEqual([0, 1, 2])
  })

  test('ignores files outside the expected range', () => {
    expect(
      missingBatchIndices(2, ['0000.txt', '0001.txt', '0099.txt'])
    ).toEqual([])
  })

  test('ignores unrelated files in the directory', () => {
    expect(missingBatchIndices(2, ['0000.txt', 'README.md'])).toEqual([1])
  })
})

describe('buildOrchestratorPrompt', () => {
  const prompt = buildOrchestratorPrompt({
    inDir: '/work/in',
    outDir: '/work/out',
    total: 73,
    concurrency: 6
  })

  test('names both directories', () => {
    expect(prompt).toContain('/work/in')
    expect(prompt).toContain('/work/out')
  })

  test('states how many batches there are', () => {
    expect(prompt).toContain('73')
  })

  test('asks for the requested parallelism', () => {
    expect(prompt).toContain('6')
  })

  test('requires the output filename to match the input', () => {
    // A subagent renaming its output would look like a missing batch.
    expect(prompt).toMatch(/same (file)?name/i)
  })

  test('forbids summarising, which would silently lose the book', () => {
    expect(prompt).toMatch(/summaris|summariz|abridge/i)
  })

  test('tells subagents to preserve the chunk delimiters', () => {
    expect(prompt).toContain('<<<CHUNK')
  })
})
