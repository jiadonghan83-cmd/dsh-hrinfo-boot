/**
 * Password gate for dsh-hrinfo-boot — host half.
 *
 * Why the check lives here rather than in the browser: anything shipped in
 * lib/client.js is readable by whoever opens DevTools, so a client-side compare
 * would leak the password and be bypassable in one line. The client only ever
 * sends a candidate and learns yes/no.
 *
 * Storage is a plugin-owned JSON file rather than the DSH settings document:
 * a `role('secret')` config field is write-only across the wire, so the host
 * could not read it back to verify. Keeping the gate self-contained also keeps
 * the plugin portable across profiles and DSH versions.
 *
 * Stored form is PBKDF2-SHA512 with a per-install random salt — never the
 * password itself — and comparisons are constant time.
 *
 * SCOPE: this gates the UI, not the API. DSH's own `/api/*` routes belong to the
 * client-connection service and a plugin cannot get in front of them, so anyone
 * holding the DSH token can reach the API without ever seeing this lock. Treat it
 * as a screen lock for an unattended machine, not as an access-control boundary.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes, pbkdf2Sync, timingSafeEqual } from 'node:crypto'

/** PBKDF2 cost. High enough to be slow for an attacker, fast enough for a login. */
const ITERATIONS = 210000
const KEY_LEN = 64
const DIGEST = 'sha512'
const SALT_BYTES = 16

/** Failed attempts before the gate starts refusing. */
const MAX_ATTEMPTS = 5
/** First lockout, doubling per subsequent failure up to LOCKOUT_MAX_MS. */
const LOCKOUT_BASE_MS = 30000
const LOCKOUT_MAX_MS = 300000

/** Code length. Must match src/hrinfo-lock.js CODE_LENGTH. */
const CODE_LENGTH = 4
/** Accepted characters: digits and ASCII letters only. */
const CODE_PATTERN = /^[0-9A-Za-z]{4}$/

/**
 * Whether a string is a usable code.
 *
 * Enforced on the host, not only in the panel: the browser-side field restricts
 * input for the operator's benefit, but a code written straight into the config
 * file must still be rejected when it cannot be typed into that field.
 *
 * @param value - candidate code.
 * @returns true when the value is exactly CODE_LENGTH digits/letters.
 */
export function isValidCode(value) {
  return typeof value === 'string' && CODE_PATTERN.test(value)
}

/**
 * Read the gate configuration.
 *
 * Locating it from DSH_HOME (rather than the module directory) matters for
 * portability: an installed plugin lives in the profile's node_modules and must
 * not try to write there.
 *
 * @param env - environment to resolve DSH_HOME from.
 * @returns the parsed config, or a disabled default when absent/unreadable.
 */
export function readConfig(env = process.env) {
  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME !== '' ? env.DSH_HOME : null
  if (home === null) return { enabled: false, path: null, config: null }
  const path = join(home, 'hrinfo-boot.json')
  if (!existsSync(path)) return { enabled: false, path, config: null }
  try {
    const config = JSON.parse(readFileSync(path, 'utf8'))
    const gate = config?.password
    if (gate === null || typeof gate !== 'object') return { enabled: false, path, config }
    if (typeof gate.hash !== 'string' || typeof gate.salt !== 'string') {
      return { enabled: false, path, config }
    }
    return { enabled: true, path, config }
  } catch {
    return { enabled: false, path, config: null }
  }
}

/** Derive the key for a candidate password against a stored salt. */
function derive(password, salt) {
  return pbkdf2Sync(password, Buffer.from(salt, 'hex'), ITERATIONS, KEY_LEN, DIGEST)
}

/**
 * Hash a password for storage.
 * @param password - the plaintext to store.
 * @returns the record to place under `password` in the config file.
 */
export function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES)
  const key = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST)
  return {
    algo: `pbkdf2-${DIGEST}`,
    iterations: ITERATIONS,
    salt: salt.toString('hex'),
    hash: key.toString('hex'),
  }
}

/**
 * Verify a candidate against a stored record.
 *
 * Uses timingSafeEqual on equal-length buffers: a length mismatch or a malformed
 * record is a plain false, never a throw, so a corrupt file cannot lock the UI out
 * with an exception.
 *
 * @param password - candidate plaintext.
 * @param gate - the stored `password` record.
 * @returns true when the candidate matches.
 */
export function verifyPassword(password, gate) {
  if (typeof password !== 'string' || password === '') return false
  if (gate === null || typeof gate !== 'object') return false
  const { salt, hash } = gate
  if (typeof salt !== 'string' || typeof hash !== 'string') return false
  let expected
  try {
    expected = Buffer.from(hash, 'hex')
  } catch {
    return false
  }
  if (expected.length !== KEY_LEN) return false
  let actual
  try {
    actual = derive(password, salt)
  } catch {
    return false
  }
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

/**
 * Failed-attempt throttle. Deliberately in-memory: a restart clearing the lockout
 * is acceptable, and persisting failures would add a write on every bad guess.
 */
export function createThrottle(options = {}) {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS
  const baseMs = options.baseMs ?? LOCKOUT_BASE_MS
  const maxMs = options.maxMs ?? LOCKOUT_MAX_MS
  let attempts = 0
  let until = 0
  return {
    /** Remaining lockout in ms, 0 when the gate is open. */
    lockedForMs(now = Date.now()) {
      return until > now ? until - now : 0
    },
    /** Record a failure and return the new lockout in ms. */
    recordFailure(now = Date.now()) {
      attempts += 1
      if (attempts < maxAttempts) return 0
      const over = attempts - maxAttempts
      const delay = Math.min(baseMs * 2 ** over, maxMs)
      until = now + delay
      return delay
    },
    /** Clear failures after a success. */
    reset() {
      attempts = 0
      until = 0
    },
    attempts() {
      return attempts
    },
  }
}

/** Write a code into the config file, creating it when absent. */
export function writePassword(password, env = process.env) {
  if (password !== null && !isValidCode(password)) {
    throw new Error(
      `code must be exactly ${CODE_LENGTH} characters from [0-9A-Za-z], got ${JSON.stringify(password)}`,
    )
  }
  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME !== '' ? env.DSH_HOME : null
  if (home === null) throw new Error('DSH_HOME is not set')
  const path = join(home, 'hrinfo-boot.json')
  let config = {}
  if (existsSync(path)) {
    try {
      config = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      config = {}
    }
  }
  config.password = password === null ? null : hashPassword(password)
  config.updatedAt = new Date().toISOString()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return path
}

export { MAX_ATTEMPTS, ITERATIONS, CODE_LENGTH, CODE_PATTERN }
