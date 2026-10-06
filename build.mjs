/**
 * Build the plugin's runtime files from source.
 *
 * The plugin is a patch of `dsh-550c-boot`, so its `lib/` cannot be produced from this
 * package alone: the upstream tarball is vendored at `vendor/550c.tgz` and this script
 * unpacks it, runs the patch, and writes the generated files into `lib/`.
 *
 * It is deliberately NOT an install-time step. `dsh plugin add` runs pnpm, and pnpm
 * blocks `prepare` scripts on git-hosted packages until the user allowlists them, so a
 * plugin that must build on install fails for most people. `lib/` is committed instead
 * and this script exists to reproduce or update it.
 *
 * Usage:
 *   node build.mjs            rebuild lib/ in place
 *   node build.mjs --check    verify lib/ matches a fresh build, exit 1 if not
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, cpSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = HERE
const check = process.argv.includes('--check')

const tarball = join(ROOT, 'vendor', '550c.tgz')
const logo = join(ROOT, 'assets', 'logo.svg')
const patchScript = join(HERE, 'scripts', 'patch.mjs')
const srcRoot = join(ROOT, 'src')

for (const required of [tarball, logo, patchScript, srcRoot]) {
  if (!existsSync(required)) {
    throw new Error('missing build input: ' + required)
  }
}

const work = mkdtempSync(join(tmpdir(), 'hrinfo-build-'))
try {
  // Unpack the pristine upstream package. `tar -xf` handles the gzip member on its own
  // and the same invocation works on Windows and POSIX, since bsdtar ships with both.
  const staging = join(work, 'stage')
  mkdirSync(staging, { recursive: true })
  execFileSync('tar', ['-xf', tarball, '-C', staging], { stdio: 'inherit' })

  const source = join(staging, 'package')
  if (!existsSync(join(source, 'package.json'))) {
    throw new Error('the vendored tarball did not contain a package/ directory')
  }

  const out = join(work, 'out')
  execFileSync(process.execPath, [patchScript, source, out, logo, srcRoot], { stdio: 'inherit' })

  // Parse-check before copying: a syntax error in a generated file would otherwise be
  // installed and only surface as a boot failure.
  for (const file of ['lib/client.js', 'lib/index.js']) {
    execFileSync(process.execPath, ['--check', join(out, file)], { stdio: 'inherit' })
  }

  const target = join(ROOT, 'lib')
  const generated = ['client.js', 'index.js', 'gate.mjs', 'set-code.mjs']

  if (check) {
    let differs = false
    for (const file of generated) {
      const fresh = readFileSync(join(out, 'lib', file), 'utf8')
      const committed = existsSync(join(target, file))
        ? readFileSync(join(target, file), 'utf8')
        : null
      if (fresh !== committed) {
        process.stderr.write('build --check: lib/' + file + ' is stale\n')
        differs = true
      }
    }
    if (differs) {
      process.stderr.write('build --check: run `node build.mjs` and commit lib/\n')
      process.exit(1)
    }
    process.stdout.write('build --check: lib/ matches a fresh build\n')
  } else {
    rmSync(target, { recursive: true, force: true })
    cpSync(join(out, 'lib'), target, { recursive: true })
    process.stdout.write('built lib/ from vendor/550c.tgz\n')
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
