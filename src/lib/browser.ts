import { chromium } from 'patchright'

/**
 * Launch Chrome against a persistent Kindle profile.
 *
 * The flag set matches the extractor's: Amazon's reader is sensitive to
 * automation fingerprints, and the profile directory is shared, so both
 * entry points must drive the same browser the same way.
 *
 * Note that Chromium takes an exclusive lock on `userDataDir`, so only one
 * of these can be open at a time -- the app runs its jobs serially for this
 * reason.
 */
export function launchKindleContext({
  userDataDir,
  headless = false,
  deviceScaleFactor = 2
}: {
  userDataDir: string
  headless?: boolean
  deviceScaleFactor?: number
}) {
  return chromium.launchPersistentContext(userDataDir, {
    headless,
    channel: 'chrome',
    args: [
      // hide chrome's crash restore popup
      '--hide-crash-restore-bubble',
      // disable chrome's password autosave popups
      '--disable-features=PasswordAutosave',
      // disable chrome's passkey popups
      '--disable-features=WebAuthn',
      // disable chrome creating 1GB temp directories on each run
      '--disable-features=MacAppCodeSignClone'
    ],
    ignoreDefaultArgs: [
      // disable chrome's default automation detection flag
      '--enable-automation',
      // adding this cause chrome shows a weird admin popup without it
      '--no-sandbox',
      // adding this cause chrome shows a weird admin popup without it
      '--disable-blink-features=AutomationControlled'
    ],
    bypassCSP: true,
    deviceScaleFactor,
    viewport: { width: 1280, height: 720 }
  })
}
