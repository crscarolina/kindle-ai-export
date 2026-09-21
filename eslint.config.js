import { config } from '@fisch0920/config/eslint'
import { globalIgnores } from 'eslint/config'

export default [
  ...config,
  globalIgnores([
    'out',
    'dist',
    'examples',
    // Bundled copy of this repo inside the built app.
    'app/build',
    'app/.build'
  ])
]
