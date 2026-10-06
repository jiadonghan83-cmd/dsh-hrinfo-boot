/**
 * Print the installed DSH version.
 *
 * A helper rather than an inline `node -e` because resolving the version means
 * building a path containing `@deepseek-ai` and `%APPDATA%`, and getting that through
 * a batch file's quoting rules is where the inline version kept breaking.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const appData = process.env.APPDATA
if (typeof appData !== 'string' || appData === '') {
  process.stderr.write('read-dsh-version: APPDATA is not set\n')
  process.exit(1)
}

const manifest = join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
if (!existsSync(manifest)) {
  process.stderr.write('read-dsh-version: DSH is not installed at ' + manifest + '\n')
  process.exit(1)
}

try {
  process.stdout.write(JSON.parse(readFileSync(manifest, 'utf8')).version)
} catch (error) {
  process.stderr.write('read-dsh-version: ' + error.message + '\n')
  process.exit(1)
}
