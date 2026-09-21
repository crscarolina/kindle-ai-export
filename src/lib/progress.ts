/**
 * Progress arithmetic for the long-running steps.
 *
 * Cleanup takes minutes and narration takes hours, so both have to say where
 * they are. Every estimate here returns `undefined` rather than a number it
 * cannot support: a confident "3 minutes left" derived from no measurement is
 * worse than silence, because the reader will plan around it.
 */

/** Whether a value can be arithmetic on without producing NaN or Infinity. */
function isUsable(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

/**
 * Render a duration the way a reader would say it.
 *
 * Seconds are dropped once the duration runs to hours: nobody waiting two
 * hours cares about the seconds, and the extra digits hide the magnitude.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return 'unknown'
  }

  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = total % 60

  if (hours) {
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`
  }

  if (minutes) {
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
  }

  return `${remainder}s`
}

export type ProgressSample = {
  /** Units of work finished so far. */
  completed: number
  /** Units of work in the whole job. */
  total: number
  /** Wall-clock time those completed units took. */
  elapsedMs: number
}

/**
 * Estimate the time left, assuming the remaining work resembles the work done.
 *
 * Returns `undefined` until there is something to extrapolate from -- no
 * completed units, or no measured time -- so a caller can stay quiet instead
 * of dividing by zero and announcing `Infinity`.
 */
export function estimateRemainingMs({
  completed,
  total,
  elapsedMs
}: ProgressSample): number | undefined {
  if (!isUsable(completed) || !isUsable(total) || !isUsable(elapsedMs)) {
    return
  }

  if (completed <= 0 || total <= 0 || elapsedMs <= 0) {
    return
  }

  return completed >= total ? 0 : (elapsedMs / completed) * (total - completed)
}

/**
 * Phrase an estimate for a human, or say nothing at all.
 *
 * Sub-second remainders are dropped: "about 0s left" reads like a stall, and
 * the work is over before anyone finishes reading it.
 */
export function describeRemaining(
  remainingMs: number | undefined
): string | undefined {
  if (remainingMs === undefined || !isUsable(remainingMs)) {
    return
  }

  return remainingMs < 1000
    ? undefined
    : `about ${formatDuration(remainingMs / 1000)} left`
}

/**
 * Scale a measurement of the completed work up to the whole job.
 *
 * Used for "this will be about six hours of audio" while only a tenth of the
 * book has been narrated.
 */
export function projectTotal({
  completed,
  total,
  value
}: {
  completed: number
  total: number
  value: number
}): number | undefined {
  if (!isUsable(completed) || !isUsable(total) || !isUsable(value)) {
    return
  }

  if (completed <= 0 || total <= 0) {
    return
  }

  return completed >= total ? value : (value / completed) * total
}

/**
 * Seconds of compute spent per second of audio produced.
 *
 * Worth reporting rather than assuming: it is the one number that predicts how
 * long the rest of a book will take on this particular machine.
 */
export function realtimeFactor({
  elapsedMs,
  audioSeconds
}: {
  elapsedMs: number
  audioSeconds: number
}): number | undefined {
  if (!isUsable(elapsedMs) || !isUsable(audioSeconds)) {
    return
  }

  if (elapsedMs <= 0 || audioSeconds <= 0) {
    return
  }

  return elapsedMs / 1000 / audioSeconds
}

/**
 * Capture progress, counted in the book's own units.
 *
 * One page spans several screenshots, so counting screenshots against a page
 * total reports more work done than the book contains -- a 652-page book
 * reached "741/652". Pages repeat, so this can hold steady for a screenshot
 * or two, but it is monotonic and never overruns.
 */
export function captureProgress({
  current,
  start,
  total,
  limit
}: {
  /** The page or location just captured. */
  current: number
  /** The first content page, after any front matter. */
  start: number
  /** The last content page. */
  total: number
  /** A preview cap, which replaces the total outright. */
  limit?: number
}): { index: number; total: number } {
  const span = Math.max(1, total - start + 1)
  const capped = limit ?? span

  return {
    index: Math.min(Math.max(0, current - start), capped),
    total: capped
  }
}
