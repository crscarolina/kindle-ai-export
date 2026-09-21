import 'dotenv/config'

import fs from 'node:fs/promises'

import { launchKindleContext } from './lib/browser'
import { parseLibraryCliArgs } from './lib/cli'
import { createReporter } from './lib/events'

const LIBRARY_URL = 'https://read.amazon.com/kindle-library'
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Establish the shared Amazon session, once.
 *
 * Chrome opens visibly and the reader signs in by hand, 2FA included. Every
 * later export reuses the profile this leaves behind, which is why the
 * pipeline scripts never need to prompt for a code they have no way to ask
 * a GUI for.
 */
async function main() {
  // eslint-disable-next-line no-process-env
  const opts = parseLibraryCliArgs(process.argv.slice(2), process.env)
  const reporter = createReporter({ json: opts.json })

  await fs.mkdir(opts.userDataDir, { recursive: true })

  const context = await launchKindleContext({
    userDataDir: opts.userDataDir,
    headless: false
  })

  try {
    const page = context.pages()[0] ?? (await context.newPage())
    await page.goto(LIBRARY_URL, { timeout: 60_000 })

    reporter.log('Complete sign-in in the Chrome window that just opened...')

    await page.waitForURL(/\/kindle-library/, { timeout: SIGN_IN_TIMEOUT_MS })

    reporter.emit({ event: 'done' })
  } catch {
    reporter.emit({ event: 'session-expired' })
    reporter.emit({ event: 'error', message: 'sign-in was not completed' })
    process.exitCode = 1
  } finally {
    await context.close()
    await context.browser()?.close()
  }
}

await main()
