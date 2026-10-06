/**
 * Set, change, or clear the dsh-hrinfo-boot unlock code.
 *
 * The code is never stored in plaintext: this writes a PBKDF2-SHA512 record into
 * `$DSH_HOME/hrinfo-boot.json`, which is the same file the host half reads. Run it
 * with the DSH environment (so DSH_HOME resolves) or pass --home.
 *
 * Usage:
 *   node set-code.mjs 7k2p             set the code
 *   node set-code.mjs 7k2p --home DIR  set with an explicit DSH home
 *   node set-code.mjs --clear          remove the code (gate off)
 *   node set-code.mjs --status         show whether a code is set
 */
import { existsSync, readFileSync } from 'node:fs'
import { CODE_LENGTH, isValidCode, readConfig, writePassword } from './gate.mjs'

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const positional = args.filter((a) => !a.startsWith('--'))

/** `--home DIR` overrides DSH_HOME for environments where it is not exported. */
function resolveEnv() {
  const at = args.indexOf('--home')
  if (at >= 0 && typeof args[at + 1] === 'string') {
    return { ...process.env, DSH_HOME: args[at + 1] }
  }
  return process.env
}

const env = resolveEnv()

function fail(message) {
  process.stderr.write(`set-code: ${message}\n`)
  process.exit(1)
}

if (flags.has('--status')) {
  const found = readConfig(env)
  const home = env.DSH_HOME ?? '(DSH_HOME not set)'
  process.stdout.write(`home:   ${home}\n`)
  process.stdout.write(`config: ${found.path ?? '(unresolved)'}\n`)
  if (found.path !== null && existsSync(found.path)) {
    let raw = {}
    try {
      raw = JSON.parse(readFileSync(found.path, 'utf8'))
    } catch {
      raw = {}
    }
    process.stdout.write(`code:   ${found.enabled ? 'SET' : 'not set'}\n`)
    if (typeof raw.updatedAt === 'string') process.stdout.write(`updated: ${raw.updatedAt}\n`)
  } else {
    process.stdout.write('code:   not set (no config file)\n')
  }
  process.exit(0)
}

if (flags.has('--clear')) {
  const path = writePassword(null, env)
  process.stdout.write(`gate disabled — code cleared in ${path}\n`)
  process.exit(0)
}

const code = positional[0]
if (code === undefined) {
  fail(`expected a ${CODE_LENGTH}-character code, or --clear / --status`)
}
if (!isValidCode(code)) {
  fail(`code must be exactly ${CODE_LENGTH} characters from [0-9A-Za-z]`)
}

const path = writePassword(code, env)
process.stdout.write(`code set in ${path}\n`)
process.stdout.write('restart DSH (or reload the page) for it to take effect.\n')
