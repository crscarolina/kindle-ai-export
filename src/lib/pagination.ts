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

/** Render a page count for a human. */
export function describePagination(pages: number | null): string {
  if (pages === null) return 'unknown'
  if (pages === 0) return 'no page numbers'
  return `${pages} page${pages === 1 ? '' : 's'}`
}
