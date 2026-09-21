/**
 * An Amazon Standard Identification Number: exactly 10 alphanumeric
 * characters. Ebooks conventionally start with `B`, but ISBN-10s are also
 * valid ASINs, so we don't require that prefix.
 */
const ASIN_REGEX = /^[\dA-Z]{10}$/i

/** Path segments that precede an ASIN in a storefront URL (`/dp/B0819W19WD`). */
const ASIN_PATH_REGEX =
  /\/(?:dp|gp\/product|product)\/([\dA-Z]{10})(?:[/?#]|$)/i

/**
 * Resolve an ASIN from either a bare identifier or any of the Kindle / Amazon
 * URLs a book can be reached by.
 *
 * Returns `undefined` rather than throwing so callers can attach their own
 * context to the failure.
 */
export function parseAsin(input: string): string | undefined {
  const value = input?.trim()
  if (!value) {
    return
  }

  if (ASIN_REGEX.test(value)) {
    return value.toUpperCase()
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return
  }

  // The `asin` query param is the most explicit signal, so it wins over a
  // path segment when a URL somehow carries both.
  for (const [key, param] of url.searchParams) {
    if (key.toLowerCase() === 'asin' && ASIN_REGEX.test(param)) {
      return param.toUpperCase()
    }
  }

  const fromPath = url.pathname.match(ASIN_PATH_REGEX)?.[1]
  return fromPath ? fromPath.toUpperCase() : undefined
}
