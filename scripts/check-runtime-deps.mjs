/**
 * Fail if anything the pipeline imports at runtime is not a production
 * dependency.
 *
 * The app bundles the pipeline after `pnpm install --prod`, so a package in
 * `devDependencies` is simply absent from a release build. That failure does
 * not show up in development, where everything is installed, nor in CI, which
 * also installs everything -- it shows up the first time somebody runs the
 * downloaded app, as `ERR_MODULE_NOT_FOUND` several steps into an export.
 * `tsx` shipped that way once and `delay` shipped that way in v0.2.0.
 */
import fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const production = new Set(Object.keys(pkg.dependencies ?? {}))
const development = new Set(Object.keys(pkg.devDependencies ?? {}))
const builtin = new Set(builtinModules)

function sourceFiles(dir) {
  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...sourceFiles(file))
    } else if (
      /\.tsx?$/.test(entry.name) &&
      // Tests never ship, and a .d.ts is erased before anything runs.
      !/\.test\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      found.push(file)
    }
  }
  return found
}

const offenders = new Map()

for (const file of sourceFiles('src')) {
  const source = fs.readFileSync(file, 'utf8')
  const specifiers = [
    ...source.matchAll(/^\s*import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm),
    ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)
  ].map((match) => match[1])

  for (const specifier of specifiers) {
    if (specifier.startsWith('.') || specifier.startsWith('node:')) continue

    const name = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0]

    if (builtin.has(name) || production.has(name)) continue

    if (!offenders.has(name)) offenders.set(name, new Set())
    offenders.get(name).add(file)
  }
}

if (offenders.size === 0) {
  console.log(
    `every runtime import in src/ is a production dependency (${production.size} declared)`
  )
  process.exit(0)
}

console.error('These are imported at runtime but absent from a --prod install:\n')
for (const [name, files] of offenders) {
  const where = development.has(name) ? 'devDependencies' : 'not declared'
  console.error(`  ${name}  (${where})`)
  for (const file of files) console.error(`      ${file}`)
}
console.error('\nMove them into "dependencies", or the released app will fail.')
process.exit(1)
