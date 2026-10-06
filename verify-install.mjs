/**
 * Post-install verification for dsh-hrinfo-boot.
 *
 * Separate from install.cmd because inlining JSON checks into a `node -e` one-liner
 * inside a batch file means fighting both cmd's percent/quote rules and Windows path
 * backslashes. This takes the profile directory as an argument instead.
 *
 * Exits non-zero with a readable reason when the install is not usable.
 *
 * Usage: node verify-install.mjs <profileDir>
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const profileDir = process.argv[2]
if (typeof profileDir !== 'string' || profileDir === '') {
  process.stderr.write('verify-install: expected the profile directory\n')
  process.exit(2)
}

const fail = (message) => {
  process.stderr.write('  [X] ' + message + '\n')
  process.exit(1)
}

// The bundle list is what actually makes DSH load the plugin; the dependency alone
// only puts the files on disk.
const profileJson = join(profileDir, 'package.json')
if (!existsSync(profileJson)) fail('no profile package.json at ' + profileJson)

let profile
try {
  profile = JSON.parse(readFileSync(profileJson, 'utf8'))
} catch (error) {
  fail('profile package.json is not valid JSON: ' + error.message)
}

const bundles = profile?.dsh?.profile?.bundles
if (!Array.isArray(bundles)) fail('the profile has no dsh.profile.bundles list')
if (!bundles.includes('dsh-hrinfo-boot')) {
  fail('dsh-hrinfo-boot is not in dsh.profile.bundles — DSH will not load it')
}

// The dependency spec must point somewhere that exists on THIS machine. A profile
// copied from another machine carries that machine's path and silently installs
// nothing.
const spec = profile?.dependencies?.['dsh-hrinfo-boot']
if (typeof spec !== 'string') fail('dsh-hrinfo-boot is missing from dependencies')
if (spec.startsWith('file:')) {
  const target = spec.slice(5)
  if (!existsSync(target)) {
    fail('the dependency points at a path that does not exist here: ' + target)
  }
}

const pluginDir = join(profileDir, 'node_modules', 'dsh-hrinfo-boot')
for (const file of ['lib/index.js', 'lib/client.js', 'lib/gate.mjs', 'src/set-code.mjs']) {
  if (!existsSync(join(pluginDir, file))) fail('installed copy is missing ' + file)
}

const manifest = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))
process.stdout.write('  [ok] registered in dsh.profile.bundles\n')
process.stdout.write('  [ok] dependency resolves on this machine\n')
process.stdout.write('  [ok] installed version ' + manifest.version + '\n')
process.stdout.write('  [ok] runtime files present\n')
