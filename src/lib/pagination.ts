/**
 * Count the page-number entries in a renderer location map.
 *
 * Amazon omits `navigationUnit` entirely for titles with no print-edition
 * pagination, and this project's extraction is built around page numbers, so
 * those books cannot be exported as-is.
 *
 * Returns `null` when no location map was captured at all: not knowing is
 * different from knowing there are none, and must not be reported as a
 * definitive "unpaginated".
 */
export function countNavigationUnits(locationMap: unknown): number | null {
  if (!locationMap || typeof locationMap !== 'object') {
    return null
  }

  const { navigationUnit } = locationMap as { navigationUnit?: unknown }
  return Array.isArray(navigationUnit) ? navigationUnit.length : 0
}

/**
 * Describe how a book is indexed.
 *
 * Books with no print pagination are exported by Kindle location, so this
 * says which index a title uses rather than whether it can be exported.
 * `null` means the location map never arrived -- a timeout, not a verdict.
 */
export function describePagination(pages: number | null): string {
  if (pages === null) return 'timed out'
  if (pages === 0) return 'by location'
  return `${pages} page${pages === 1 ? '' : 's'}`
}
