import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // A release bundle contains a full copy of this repo at
    // `app/build/KindleExport.app/Contents/Resources/repo`, and a debug bundle
    // symlinks it. Either way the repo's own tooling must not walk back into
    // it, or every test runs twice against a stale copy.
    exclude: ['**/node_modules/**', '**/dist/**', 'app/build/**', 'examples/**']
  }
})
