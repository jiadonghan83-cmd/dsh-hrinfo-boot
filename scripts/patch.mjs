/**
 * Build the HRINFO fork from the installed 550C plugin.
 *
 * Surgical, anchored, idempotent patches on the built bundle:
 *   1. inject the HRINFO vector logo into the splash stage
 *   2. drop the ported 550C geometry (keeping the despike filter the CSS uses)
 *   3. rebrand the boot text / HUD
 *   4. recolour the splash to the HRINFO blue scheme
 *   5. add the falling-character rain module and wire its lifecycle
 *
 * Anchored replacement (rather than a re-extract) keeps the ported animation code
 * byte-identical apart from what branding requires.
 *
 * Usage: node patch.mjs <srcPluginDir> <forkDir> <logo.svg>
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const [, , srcDir, forkDir, logoPath, srcRootArg] = process.argv
// Where the plugin's own sources live (hrinfo-rain.js, hrinfo-lock.js, gate.mjs,
// set-code.mjs). Defaults to the sibling `src/` of this script's parent, which is the
// maintainer layout (build/ next to src/); pass it explicitly when this script is
// invoked from a package whose layout differs.
const SRC_ROOT = srcRootArg ?? join(HERE, '..', 'src')
if (!srcDir || !forkDir || !logoPath) {
  console.error('usage: node patch.mjs <srcPluginDir> <forkDir> <logo.svg> [srcRoot]')
  process.exit(2)
}

/* ---------- 0. copy the plugin ---------- */
if (existsSync(forkDir)) rmSync(forkDir, { recursive: true, force: true })
mkdirSync(forkDir, { recursive: true })
cpSync(join(srcDir, 'lib'), join(forkDir, 'lib'), { recursive: true })
if (existsSync(join(srcDir, 'LICENSE'))) cpSync(join(srcDir, 'LICENSE'), join(forkDir, 'LICENSE'))

const rain = readFileSync(join(SRC_ROOT, 'hrinfo-rain.js'), 'utf8')
const lock = readFileSync(join(SRC_ROOT, 'hrinfo-lock.js'), 'utf8')
const gate = readFileSync(join(SRC_ROOT, 'gate.mjs'), 'utf8')

/** Bundle-factory indentation used by the built client bundle. */
const CT = '\t\t    '
/** Indentation inside the try block that starts the show. */
const CT2 = '\t\t      '
/** Same as CT; named separately where the patch reads better for it. Real tabs,
 *  not the two characters backslash-t — a literal '\t' silently misses every anchor. */
const CTAB = '\t\t    '

/* ---------- 1. read the bundle ---------- */
const clientPath = join(forkDir, 'lib', 'client.js')
let code = readFileSync(clientPath, 'utf8')

const applied = []
function replaceOnce(label, from, to) {
  const at = code.indexOf(from)
  if (at < 0) throw new Error(`anchor not found: ${label}`)
  code = code.slice(0, at) + to + code.slice(at + from.length)
  applied.push(label)
}

/**
 * Replace a single line whose leading whitespace is unknown.
 *
 * The built bundle's indentation is not uniform (the factory mixes tab and space
 * runs between its regions), so anchors that encode a guessed indent break as soon
 * as they land in a differently-indented region. Only the leading run is matched
 * and reused, so the output's indentation stays intact.
 *
 * `prefix` need not span the whole line: whatever follows it is preserved.
 */
function replaceLine(label, prefix, replacement) {
  const pattern = new RegExp(`^([ \\t]*)${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm')
  const match = pattern.exec(code)
  if (match === null) throw new Error(`anchor line not found: ${label}`)
  code = code.slice(0, match.index) + replacement(match[1]) + code.slice(match.index + match[0].length)
  applied.push(label)
}

/* ---------- 2. rebrand the bundle's own module id ---------- */
// The client module system keys registrations by package name, so the id the
// bundle registers under MUST equal the entry name. Leaving the inherited
// "dsh-550c-boot" here makes the client half fail to load with
// `could not load "dsh-hrinfo-boot"` while the host half still works.
const NEW_ID = 'dsh-hrinfo-boot'
replaceOnce('module id', 'id: "dsh-550c-boot"', `id: "${NEW_ID}"`)
for (const stale of ['dsh-550c-boot']) {
  const n = code.split(stale).length - 1
  if (n > 0) {
    code = code.split(stale).join(NEW_ID)
    applied.push(`self-reference "${stale}" -> "${NEW_ID}" (${n})`)
  }
}

/* ---------- 3. the HRINFO logo ---------- */
const logoSvg = readFileSync(logoPath, 'utf8').trim()
// Keep the <svg> root: dropping it leaves bare <g>/<text> in the HTML, which the
// parser lifts out of the SVG namespace and renders as nothing.
const svgRoot = logoSvg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
const svgInner = svgRoot
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .trim()
const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(logoSvg)
const svgStyle = styleMatch === null ? '' : styleMatch[1].trim()

const svgNoStyle = svgRoot.replace(/<style>[\s\S]*?<\/style>/, '')
// Inline fill/style as well: the CSS block inside a string-literal template is one
// more thing that can silently fail, and these attributes cannot.
const svgSelfContained = svgNoStyle
  .replace(/class="hrinfo-logo"/, 'class="hrinfo-logo" fill="none"')
  .replace(/<g class="hrinfo-word">/g, '<g class="hrinfo-word" style="fill:#eef4ff">')
  .replace(/<circle class="hrinfo-red"/g, '<circle class="hrinfo-red" style="fill:#e02020"')

// The ported markup only defines <defs>, which never render; this wrapper is
// inserted where it will actually be painted, style hoisted beside it.
const logoBlock = `<style>${svgStyle}</style><div class="hrinfo-stage">${svgSelfContained}</div>`

// BOOT_MARKUP is a JS string literal, so its quotes are backslash-escaped here
// and anything inserted into it must be escaped the same way.
const STAGE_ANCHOR = '<div class=\\"boot-stage\\">'

/** Escape a markup fragment for embedding inside the BOOT_MARKUP string literal. */
function escapeForJsString(markup) {
  return markup
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n')
}

if (!code.includes(STAGE_ANCHOR)) throw new Error('boot-stage anchor not found')
// The opaque backdrop goes in as the stage's first child, ahead of the rain canvas
// that mountRain() prepends, so it paints behind everything.
const STAGE_BACKDROP = '<div class=\\"hrinfo-bg\\"></div>'
code = code.replace(STAGE_ANCHOR, STAGE_ANCHOR + STAGE_BACKDROP + escapeForJsString(logoBlock))
applied.push('backdrop + logo injected into boot stage')

/* ---------- 3. drop the ported 550C geometry, keep the filter ---------- */
const bootStart = code.indexOf('const BOOT_MARKUP = "')
if (bootStart < 0) throw new Error('BOOT_MARKUP not found')
const openIdx = code.indexOf('<svg viewBox=\\"0 0 800 230\\"', bootStart)
if (openIdx < 0) throw new Error('ported svg not found inside BOOT_MARKUP')
const closeIdx = code.indexOf('</svg>', openIdx)
if (closeIdx < 0) throw new Error('ported svg close tag not found')
const portedSvg = code.slice(openIdx, closeIdx + '</svg>'.length)
const defsMatch = /<defs>[\s\S]*?<\/defs>/.exec(portedSvg)
if (defsMatch === null) throw new Error('<defs> not found inside the ported svg')
code = code.slice(0, openIdx) + defsMatch[0] + code.slice(closeIdx + '</svg>'.length)
applied.push('ported 550C geometry removed (despike filter kept)')

/* ---------- 5. make playBoot tolerate the replaced logo ---------- */
// The ported 550C <g id="logo"> is gone (dropped in step 3), but playBoot() still
// looks it up and dereferences it 鈥?which throws on the first frame and ends the
// splash immediately. Guard every lookup so a missing logo degrades to "no draw-in
// animation" instead of a dead overlay.
replaceOnce(
  'playBoot logo guard',
  '\t\t  const logo = stage.querySelector(\'#logo\');\n' +
    '\t\t  const bootText = stage.querySelector(\'#bootText\');\n' +
    '\t\t  const paths = Array.from(logo.querySelectorAll(\'path\'));',
  '\t\t  const logo = stage.querySelector(\'#logo\');\n' +
    '\t\t  const bootText = stage.querySelector(\'#bootText\');\n' +
    '\t\t  const paths = logo === null ? [] : Array.from(logo.querySelectorAll(\'path\'));',
)
replaceOnce(
  'playBoot later guard',
  '\t\t  later(() => logo.classList.add(\'finished\'), totalMs);',
  '\t\t  if (logo !== null) later(() => logo.classList.add(\'finished\'), totalMs);',
)
replaceOnce(
  'playBoot text guard',
  '\t\t  later(() => bootText.classList.add(\'show\'), 2400);',
  '\t\t  if (bootText !== null) later(() => bootText.classList.add(\'show\'), 2400);',
)

/* ---------- 6. branding text ---------- */
for (const [from, to] of [
  ['550C SYSTEM BOOT', 'HRINFO SYSTEM BOOT'],
  ['550C CORE TERMINAL', 'HRINFO CORE TERMINAL'],
  ['550C // UAV-BS-07', 'HRINFO // CORE'],
]) {
  const n = code.split(from).length - 1
  if (n > 0) {
    code = code.split(from).join(to)
    applied.push(`text "${from}" -> "${to}" (${n})`)
  }
}

/* ---------- 7. HRINFO blue scheme ---------- */
for (const [from, to] of [
  ['--bg:#050403', '--bg:#04070f'],
  ['--amber:#e8a020', '--amber:#5fd0e8'],
  ['--amber-b:#ffc043', '--amber-b:#9ae8f8'],
  ['--amber-d:#8a5e10', '--amber-d:#1f4d8f'],
  ['--amber-fade:rgba(232,160,32,.35)', '--amber-fade:rgba(95,208,232,.35)'],
  ['--text:#d8c090', '--text:#b9d4ef'],
  ['--text-dim:#8a7248', '--text-dim:#6f8fb5'],
  ['--text-faint:#4a3f28', '--text-faint:#2f4666'],
  ['--bg-panel:#0a0805', '--bg-panel:#070c16'],
  ['--bg-win:#0d0a06', '--bg-win:#080e1a'],
  ['.white{fill:#fff;stroke:none;}', '.white{fill:#eef4ff;stroke:none;}'],
  ['.red{fill:#ff2d2d;stroke:none;}', '.red{fill:#e02020;stroke:none;}'],
  // rain palette tokens ride the same scheme block
  ['--green:#b8c840;', '--green:#b8c840;--rain:#3f96e0;--rain-bright:#7fe0f5;--rain-head:#ffffff;'],
]) {
  const n = code.split(from).length - 1
  if (n > 0) {
    code = code.split(from).join(to)
    applied.push(`palette ${from} (${n})`)
  }
}

/* ---------- 8. rain module + CSS ---------- */
// Strip the module keyword before indenting: the bundle's factory is not a module.
const rainSource = rain
  .replace(/^export\s+/m, '')
  .split('\n')
  .map((line) => '\t\t' + line)
  .join('\n')

const rainCss =
  // `#boot` must stop painting its own black: it is opaque, and an opaque #boot covers
  // everything the splash draws inside it. Specificity matters — the ported sheet
  // already carries `#boot{...background:#000}` and at equal specificity the LAST rule
  // wins, so this has to out-specify it.
  '#boot#boot{background:transparent}' +
  // The host carries no background of its own; without an opaque layer the splash
  // fades to transparent and the interface shows through the lock panel. This lives on
  // its own element rather than on .boot-stage, because an element's background paints
  // before its positioned descendants and would sit on top of the splash content.
  '.boot-stage{background:transparent}' +
  '.hrinfo-bg{position:absolute;inset:0;z-index:0;pointer-events:none;background:var(--bg,#04070f)}' +
  // `.boot-stage` needs a real box: the ported sheet declares
  // `.dsh550c-stage{height:100%}` AFTER the plugin's own rule, so a height set here on
  // the stage never applied and its inset:0 children resolved against a zero-height
  // ancestor.
  '.boot-stage{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;z-index:1}' +
  // Only the gated variant takes the lockup out of flow. With a code panel present the
  // flex centring would centre lockup+panel as one group and shove the wordmark up;
  // without a gate the original centring applies unchanged.
  '.hrinfo-gated .boot-stage{display:block;position:absolute;inset:0}' +
  '.hrinfo-stage{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1000;width:100%;max-width:1040px;padding:0 24px}' +
  // The ported sheet sizes the lockup with `.boot-stage svg{width:min(680px,90vw)}`,
  // which out-specifies a single-class rule and left the wordmark pinned left of its
  // container. The override therefore has to beat it outright.
  '.hrinfo-stage svg{width:100% !important;max-width:100% !important;height:auto;' +
    'overflow:visible;display:block;margin:0 auto}' +
  '.hrinfo-stage .hrinfo-lock{position:absolute;left:50%;top:100%;transform:translateX(-50%);margin-top:26px;z-index:1200}' +
  // z-index 950 is load-bearing. The ported sheet paints two full-viewport pseudo
  // elements above the splash content — `:host::before` scanlines at 900 and
  // `:host::after` a vignette at 899 whose edge is 85% opaque. A rain layer below 899
  // is painted over by both, which is what hid an earlier build while its own pixels
  // were provably being drawn. 950 clears them and stays under the wordmark at 1000.
    // The rain is a BODY-LEVEL layer, not an overlay descendant: measured, a canvas
  // inside the overlay's shadow root composites only a sliver of itself (618 px of a
  // full-viewport element, with no clipping in its ancestor chain), while the same
  // canvas on the body composites whole (1,024,000 px). It therefore sits below the
  // overlay, and the overlay's background is made transparent so the rain shows
  // through it.
  '.hrinfo-rain{position:fixed;left:0;top:0;width:100%;height:100%;z-index:900;pointer-events:none}' +
  // The overlay's own sheet paints `:host{background:var(--bg)}` with --bg an opaque
  // near-black, and that covered the body-level rain layer completely: the reported
  // symptom was the rain flashing into view only as the overlay faded out on exit.
  //
  // It cannot be fixed from the document. `--bg` is declared on `:host` INSIDE the
  // shadow root, and shadow-host declarations are lifted into the outer tree, so a
  // document-level `.dsh550c-host{--bg:...}` loses to it however specific it is (and
  // `#boot#boot{background}` does not touch it either). The host background is instead
  // made transparent where it is declared, in the shadow sheet, leaving `.hrinfo-bg` as
  // the splash's own backdrop.
  '.hrinfo-bg{background:#04070f}'
replaceOnce(
  'rain css',
  'const CSS_550C = "',
  'const CSS_550C = "\\n  /* ===== HRINFO rain ===== */\\n  ' + rainCss + '\\n" + "',
)
// The overlay's own sheet paints the host element opaque. `--bg` is declared on
// `:host` INSIDE the shadow root and shadow-host declarations are lifted into the
// outer tree, so a document-level override loses to it however specific it is. The
// background is therefore removed where it is declared, which is what lets the
// body-level rain layer show through the splash instead of being hidden until the
// overlay fades out.
replaceOnce(
  'transparent host background',
  ':host{background:var(--bg);',
  ':host{background:transparent;',
)
replaceOnce('rain module', '\t\t//#region src/show.js', `${rainSource}\n\n\t\t//#region src/show.js`)
replaceOnce(
  'rain start',
  '\t\t    record.show = createShow(stage, { mode: mode, cancelled: CANCELLED })',
  '\t\t    // revealText shapes the rain into the wordmark: the drops that cross the\n' +
'\t\t    // mask are drawn bright and steady, the rest stays dim.\n' +
'\t\t    record.rain = mountRain(stage)\n' +
    '\t\t    record.show = createShow(stage, { mode: mode, cancelled: CANCELLED })',
)
replaceOnce(
  'rain dispose',
  '\t\t    if (record.caption !== null) record.caption()',
  '\t\t    if (record.caption !== null) record.caption()\n' +
    '\t\t    if (record.rain != null) record.rain()',
)
replaceOnce(
  'rain record field',
  'const record = { host: host, dragBand: dragBand, show: null, enhance: null, caption: null, finished: false, fadeTimer: null, watchdog: null, dispose: null }',
  'const record = { host: host, dragBand: dragBand, show: null, enhance: null, caption: null, rain: null, finished: false, fadeTimer: null, watchdog: null, dispose: null }',
)

/* ---------- 9. password gate: host half ---------- */
// The gate module ships beside lib/index.js so the plugin stays self-contained,
// and the setter ships with it so anyone who installs the plugin can set a code
// without reaching into the plugin's own repository.
writeFileSync(join(forkDir, 'lib', 'gate.mjs'), gate, 'utf8')
writeFileSync(
  join(forkDir, 'lib', 'set-code.mjs'),
  readFileSync(join(SRC_ROOT, 'set-code.mjs'), 'utf8'),
  'utf8',
)
if (!existsSync(join(forkDir, 'lib', 'set-code.mjs'))) {
  throw new Error('failed to write lib/set-code.mjs into the fork')
}
applied.push('host gate module + code setter written')

const hostPath = join(forkDir, 'lib', 'index.js')
let host = readFileSync(hostPath, 'utf8')

function replaceHost(label, from, to) {
  const at = host.indexOf(from)
  if (at < 0) throw new Error(`host anchor not found: ${label}`)
  host = host.slice(0, at) + to + host.slice(at + from.length)
  applied.push(`host: ${label}`)
}

replaceHost(
  'gate import',
  "import { spawn } from 'node:child_process'",
  "import { spawn } from 'node:child_process'\n" +
    "import { createThrottle, readConfig, verifyPassword } from './gate.mjs'",
)

replaceHost(
  'gate global constant',
  'const FIRST_FRAME_GLOBAL = ',
  "/** src/client.js GATE_GLOBAL — keep in sync. Tells the page whether to lock. */\n" +
    "const GATE_GLOBAL = '__dsh550cGate'\n" +
    '/** src/client.js UNLOCK_ROUTE — keep in sync. */\n' +
    "const UNLOCK_ROUTE = '/hrinfo-boot/unlock'\n" +
    'const FIRST_FRAME_GLOBAL = ',
)

// Unlock: does a password exist, and does this candidate match it.
replaceHost(
  'unlock handler',
  "/**\n * The cover itself: the port's own background colour, above anything the page",
  'async function unlockHandler(req, res) {\n' +
    "  if (req.method !== 'POST') {\n" +
    "    res.writeHead(405, { allow: 'POST' })\n" +
    '    res.end()\n' +
    '    return\n' +
    '  }\n' +
    '  const found = readConfig()\n' +
    '  if (!found.enabled) {\n' +
    '    sendJson(res, 200, { ok: true, unlockRequired: false })\n' +
    '    return\n' +
    '  }\n' +
    '  const wait = throttle.lockedForMs()\n' +
    '  if (wait > 0) {\n' +
    '    sendJson(res, 429, {\n' +
    '      ok: false,\n' +
    '      unlockRequired: true,\n' +
    '      locked: true,\n' +
    '      retryAfterMs: wait,\n' +
    "      message: `TOO MANY ATTEMPTS — RETRY IN ${Math.ceil(wait / 1000)}S`,\n" +
    '    })\n' +
    '    return\n' +
    '  }\n' +
    "  // The body stream can only be read once; parsing it twice yields an empty\n" +
    "  // string on the second pass and would silently reject every valid code.\n" +
    '  const raw = await readBody(req).catch(() => \'\')\n' +
    '  let candidate = null\n' +
    '  try {\n' +
    "    const parsed = raw === '' ? null : JSON.parse(raw)\n" +
    "    if (parsed !== null && typeof parsed.password === 'string') candidate = parsed.password\n" +
    '  } catch {\n' +
    '    candidate = null\n' +
    '  }\n' +
    '  if (candidate !== null && verifyPassword(candidate, found.config.password)) {\n' +
    '    throttle.reset()\n' +
    '    sendJson(res, 200, { ok: true, unlockRequired: true })\n' +
    '    return\n' +
    '  }\n' +
    '  const penalty = throttle.recordFailure()\n' +
    '  sendJson(res, 401, {\n' +
    '    ok: false,\n' +
    '    unlockRequired: true,\n' +
    '    locked: penalty > 0,\n' +
    '    retryAfterMs: penalty,\n' +
    '    message:\n' +
    "      penalty > 0 ? `LOCKED — RETRY IN ${Math.ceil(penalty / 1000)}S` : 'WRONG PASSWORD',\n" +
    '  })\n' +
    '}\n\n' +
    '/** Failed-attempt throttle shared by every unlock request. */\n' +
    'const throttle = createThrottle()\n\n' +
    '/**\n * The cover itself: the port\'s own background colour, above anything the page',
)

replaceHost(
  'gate index-inject rows',
  "    if (VERSION !== null) table.push({ kind: 'global', name: VERSION_GLOBAL, value: VERSION })",
  "    if (VERSION !== null) table.push({ kind: 'global', name: VERSION_GLOBAL, value: VERSION })\n" +
    '    // Read once per response: an operator may add or clear the password file\n' +
    '    // while the process runs, and the next page load should honour it.\n' +
    '    table.push({ kind: \'global\', name: GATE_GLOBAL, value: readConfig().enabled })',
)

// Register the unlock route next to the update routes.
const unlockRoute = () =>
  "    webCtx.effect(\n" +
  '      () =>\n' +
  '        webCtx.webServer.register({\n' +
  "          kind: 'exact',\n" +
  '          path: UNLOCK_ROUTE,\n' +
  '          handler: unlockHandler,\n' +
  '        }),\n' +
  '      `boot-hrinfo: POST ${UNLOCK_ROUTE}`,\n' +
  '    )\n'
replaceHost(
  'unlock route registration',
  "    webCtx.effect(\n      () =>\n        webCtx.webServer.register({\n          kind: 'exact',\n          path: UPDATE_ROUTE,",
  unlockRoute() +
    "    webCtx.effect(\n      () =>\n        webCtx.webServer.register({\n          kind: 'exact',\n          path: UPDATE_ROUTE,",
)

writeFileSync(hostPath, host, 'utf8')

/* ---------- 10. password gate: browser half ---------- */
const lockSource = lock
  .replace(/^export\s+/gm, '')
  .split('\n')
  .map((line) => '\t\t' + line)
  .join('\n')

replaceOnce('lock module', '\t\t//#region src/show.js', `${lockSource}\n\n\t\t//#region src/show.js`)

// Gate constants the host half keeps in sync.
replaceLine(
  'lock constants',
  'const FIRST_FRAME_GLOBAL = ',
  (ind) =>
    `${ind}/** src/index.js GATE_GLOBAL — keep in sync. */\n` +
    `${ind}const GATE_GLOBAL = '__dsh550cGate'\n` +
    `${ind}/** src/index.js UNLOCK_ROUTE — keep in sync. */\n` +
    `${ind}const UNLOCK_ROUTE = '/hrinfo-boot/unlock'\n` +
    `${ind}const FIRST_FRAME_GLOBAL = `,
)

// Gate state on the overlay record.
replaceLine(
  'lock record fields',
  'const record = { host: host, dragBand: dragBand, show: null, enhance: null, caption: null, rain: null, finished: false, fadeTimer: null, watchdog: null, dispose: null }',
  (ind) =>
    `${ind}const record = { host: host, dragBand: dragBand, show: null, enhance: null, caption: null, rain: null, lockPanel: null, locked: false, live: false, finished: false, fadeTimer: null, watchdog: null, dispose: null }`,
)

// Release helper lives with the other record helpers...
replaceLine('lock release', 'const skip = () => {', (ind) => {
  const b = ind
  const s = `${ind}  `
  return [
    `${b}const release = () => {`,
    `${s}record.locked = false`,
    `${s}host.classList.remove('hrinfo-locked')`,
    `${s}if (record.lockPanel !== null) {`,
    `${s}  record.lockPanel.dispose()`,
    `${s}  record.lockPanel = null`,
    `${s}}`,
    `${s}record.fadeTimer = window.setTimeout(dispose, FADE_MS + 40)`,
    `${b}}`,
    `${b}`,
    `${b}const skip = () => {`,
  ].join('\n')
})

// ...but the panel itself is built inside the try block, because it needs `stage`.
// Defining it outside throws `stage is not defined` at the moment the gate opens.
replaceLine(
  'lock panel builder',
  'record.rain = mountRain(stage)',
  (ind) =>
    `${ind}record.rain = mountRain(stage)\n` +
    `${ind}// Only the gated layout takes the lockup out of flow; see the stylesheet.\n` +
    `${ind}if (window[GATE_GLOBAL] === true) host.classList.add('hrinfo-gated')\n` +
    `${ind}record.live = true\n` +
    `${ind}const showLockPanel = () => {\n` +
    `${ind}  if (record.lockPanel !== null || record.locked) return\n` +
    `${ind}  record.locked = true\n` +
    `${ind}  host.classList.add('hrinfo-locked')\n` +
    `${ind}  const lockStyle = document.createElement('style')\n` +
    `${ind}  lockStyle.textContent = LOCK_CSS\n` +
    `${ind}  const lockTarget = stage.querySelector('.hrinfo-stage') ?? stage\n` +
    `${ind}  lockTarget.appendChild(lockStyle)\n` +
    `${ind}  record.lockPanel = createLockPanel({\n` +
    `${ind}    submitLabel: 'UNLOCK',\n` +
    `${ind}    onSubmit: async (value) => {\n` +
    `${ind}      let body = null\n` +
    `${ind}      try {\n` +
    `${ind}        const res = await fetch(UNLOCK_ROUTE, {\n` +
    `${ind}          method: 'POST',\n` +
    `${ind}          headers: { 'content-type': 'application/json' },\n` +
    `${ind}          body: JSON.stringify({ password: value }),\n` +
    `${ind}        })\n` +
    `${ind}        body = await res.json()\n` +
    `${ind}      } catch (error) {\n` +
    `${ind}        return { ok: false, message: 'HOST UNREACHABLE' }\n` +
    `${ind}      }\n` +
    `${ind}      // A gate switched off since the page loaded must not become a dead end.\n` +
    `${ind}      if (body !== null && (body.ok === true || body.unlockRequired === false)) {\n` +
    `${ind}        window.setTimeout(release, 240)\n` +
    `${ind}        return { ok: true }\n` +
    `${ind}      }\n` +
    `${ind}      return { ok: false, message: (body && body.message) || 'DENIED' }\n` +
    `${ind}    },\n` +
    `${ind}  })\n` +
    `${ind}  lockTarget.appendChild(record.lockPanel.element)\n` +
    `${ind}}\n` +
    `${ind}// Exposed so the lock shortcut can summon the gate even when no timer is\n` +
    `${ind}// pending — after an unlock there is no countdown left to fire it.\n` +
    `${ind}record.showLock = showLockPanel\n` +
    `${ind}// Arming the gate must not race the show: finish() fires as soon as the\n` +
    `${ind}// animation resolves, so a timer that lands later leaves the splash already\n` +
    `${ind}// fading and an opacity transition in flight. Lock on the next frame instead —\n` +
    `${ind}// after the stage exists, before the show can complete.\n` +
    `${ind}window.requestAnimationFrame(() => {\n` +
    `${ind}  if (!record.live) return\n` +
    `${ind}  if (window[GATE_GLOBAL] !== true) return\n` +
    `${ind}  try {\n` +
    `${ind}    showLockPanel()\n` +
    `${ind}  } catch (error) {\n` +
    `${ind}    // A throwing gate would strand an unlockable overlay on screen, which is\n` +
    `${ind}    // worse than no gate at all: report it and let the splash retire.\n` +
    `${ind}    window.__hrinfoLockError = String((error && error.stack) || error)\n` +
    `${ind}    console.error('[hrinfo-boot] lock panel failed', error)\n` +
    `${ind}    record.locked = false\n` +
    `${ind}    host.classList.remove('hrinfo-locked')\n` +
    `${ind}    dispose()\n` +
    `${ind}  }\n` +
    `${ind}})`,
)

// Hold the splash while the gate is unresolved.
//
// `finish()` must do NOTHING when a code is required: starting the fade there would
// leave an opacity transition in flight for the lock to fight, and the overlay has
// to stay up regardless. `release()` performs the fade and dispose once the host
// has accepted the code.
replaceLine(
  'lock finish gate',
  'record.finished = true',
  (ind) =>
    `${ind}record.finished = true\n` +
    `${ind}// With a code configured the splash must not retire until the host says yes;\n` +
    `${ind}// release() fades and disposes it instead. Returning before the fade also\n` +
    `${ind}// means no opacity transition is left in flight for the lock to fight.\n` +
    `${ind}if (record.locked) return`,
)

// Release the panel when the overlay goes away.
replaceLine(
  'lock dispose',
  'if (record.rain != null) record.rain()',
  (ind) =>
    `${ind}if (record.rain != null) record.rain()\n` +
    `${ind}if (record.lockPanel != null) record.lockPanel.dispose()\n` +
    `${ind}record.live = false`,
)

// The key handlers are assigned in the try block but removed by dispose(), which
// lives outside it. Declaring them at record scope is what lets cleanup see them:
// leaving them as consts inside the try made dispose throw `onLockKey is not
// defined`, which aborted the re-lock and left the user unlocked with no panel.
replaceLine(
  'lock key handler slots',
  'const skip = () => {',
  (ind) =>
    `${ind}// Assigned in the try block, read by dispose().\n` +
    `${ind}let onKey = null\n` +
    `${ind}let onLockKey = null\n` +
    `${ind}const skip = () => {`,
)
replaceLine(
  'lock shortcut',
  "const onKey = (event) => {",
  (ind) => `${ind}onKey = (event) => {`,
)
replaceLine(
  'lock shortcut cleanup',
  "window.removeEventListener('keydown', onKey, true)",
  (ind) =>
    `${ind}if (onKey !== null) window.removeEventListener('keydown', onKey, true)\n` +
    `${ind}if (onLockKey !== null) window.removeEventListener('keydown', onLockKey, true)`,
)
replaceLine(
  'lock handler assignments',
  'record.live = true',
  (ind) =>
    `${ind}record.live = true\n` +
    `${ind}onKey = (event) => {\n` +
    `${ind}  if (event.key === 'Escape') skip()\n` +
    `${ind}}\n` +
    `${ind}onLockKey = (event) => {\n` +
    `${ind}  if (event.ctrlKey && event.shiftKey && (event.key === 'L' || event.key === 'l')) {\n` +
    `${ind}    event.preventDefault()\n` +
    `${ind}    lockNow()\n` +
    `${ind}  }\n` +
    `${ind}}`,
)

// Re-arm the gate on demand: retire the live overlay so the next mount locks again.
replaceLine(
  'lock now helper',
  'let liveOverlay = null',
  (ind) =>
    `${ind}/**\n` +
    `${ind} * Re-arm the lock on demand. There is no unlocked state to persist — every\n` +
    `${ind} * page load starts locked — so re-locking means retiring the current overlay\n` +
    `${ind} * and letting a fresh mount run the gate again.\n` +
    `${ind} */\n` +
    `${ind}function lockNow() {\n` +
    `${ind}  if (window[GATE_GLOBAL] !== true) return\n` +
    `${ind}  // Retire any live overlay and build a fresh one that is locked from the\n` +
    `${ind}  // start. It cannot be left to the next mount: after a successful unlock the\n` +
    `${ind}  // overlay is disposed, so there may be nothing left to re-arm.\n` +
    `${ind}  if (liveOverlay !== null) {\n` +
    `${ind}    try {\n` +
    `${ind}      liveOverlay.dispose()\n` +
    `${ind}    } catch (error) {\n` +
    `${ind}      console.error('[hrinfo-boot] disposing the overlay failed', error)\n` +
    `${ind}      if (liveOverlay.host && liveOverlay.host.remove) liveOverlay.host.remove()\n` +
    `${ind}    }\n` +
    `${ind}    liveOverlay = null\n` +
    `${ind}  }\n` +
    `${ind}  const record = mountOverlay(true)\n` +
    `${ind}  if (record === null) return\n` +
    `${ind}  // Lock on the next frame: the overlay's stage must exist before the panel\n` +
    `${ind}  // can be attached to it.\n` +
    `${ind}  window.requestAnimationFrame(() => {\n` +
    `${ind}    if (!record.live) return\n` +
    `${ind}    if (typeof record.showLock === 'function') record.showLock()\n` +
    `${ind}  })\n` +
    `${ind}}\n` +
    `${ind}let liveOverlay = null`,
)

writeFileSync(clientPath, code, 'utf8')
// The re-lock shortcut must outlive the overlay.
//
// Registering it alongside the overlay's other listeners was wrong: unlocking
// disposes the overlay, which removes those listeners, so the shortcut stopped
// working exactly when it is most wanted. This one lives at module scope — the same
// scope as the splash teardown — and re-mounts a locked overlay on demand.
replaceOnce(
  'lock shortcut persistent',
  '\t\tconst bootSplash = mountOverlay(false)',
  '\t\t/** Lock the UI on demand, whether or not an overlay is currently live. */\n' +
    '\t\tfunction lockShortcut(event) {\n' +
    "\t\t  if (!event.ctrlKey || !event.shiftKey) return\n" +
    "\t\t  if (event.key !== 'l' && event.key !== 'L') return\n" +
    '\t\t  event.preventDefault()\n' +
    '\t\t  lockNow()\n' +
    '\t\t}\n' +
    "\t\twindow.addEventListener('keydown', lockShortcut, true)\n" +
    '\t\tconst bootSplash = mountOverlay(false)',
)

/* ---------- 11. package manifest + bundle patch ---------- */
const pkg = JSON.parse(readFileSync(join(srcDir, 'package.json'), 'utf8'))
pkg.name = 'dsh-hrinfo-boot'
pkg.version = '0.1.0'
pkg.description = 'HRINFO boot splash for DSH: pure-vector HRINFO wordmark with falling-character rain.'
delete pkg.dshWorkshop
writeFileSync(join(forkDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8')

writeFileSync(
  join(forkDir, 'cordis.patch.yml'),
  [
    '# Bundle patch for dsh-hrinfo-boot.',
    '#',
    "# The row below mounts the plugin; the package's `dsh.client` block is what",
    '# gets the browser half served and loaded.',
    '- insert:',
    '    - id: boot-hrinfo',
    '      name: dsh-hrinfo-boot',
    '',
  ].join('\n'),
  'utf8',
)

/* ---------- 10. optional diagnostics ---------- */
// DIAG=1 injects trace points into the show lifecycle. A splash that ends early
// has no error to read, so the only way to locate it is to record which branch ran.
if (process.env.DIAG === '1') {
  code = code.replace(
    'const stage = document.createElement(\'div\')',
    'window.__hrtrace = window.__hrtrace || [];window.__hrtrace.push("mount:" + Date.now());const stage = document.createElement(\'div\')',
  )
  code = code.replace(
    '\t\t    const totalMs = playBoot();',
    '\t\t    window.__hrtrace.push("start:enter:" + Date.now() + ":booting=" + booting + ":launched=" + launched);\n' +
      '\t\t    const totalMs = playBoot();\n' +
      '\t\t    window.__hrtrace.push("playBoot:" + totalMs);',
  )
  code = code.replace(
    '\t\t    record.show.start().then(finish, finish)',
    '\t\t    window.__hrtrace.push("start:called:" + Date.now());\n' +
      '\t\t    record.show.start().then(\n' +
      '\t\t      () => { window.__hrtrace.push("show:resolved:" + Date.now()); finish() },\n' +
      '\t\t      (e) => { window.__hrtrace.push("show:rejected:" + Date.now() + ":" + String(e)); finish() },\n' +
      '\t\t    )',
  )
  code = code.replace(
    'const skip = () => {',
    'const skip = () => {\n\t\t    window.__hrtrace.push("skip:" + Date.now())',
  )
  code = code.replace(
    'if (booting || launched) return;',
    'if (booting || launched) { window.__hrtrace.push("start:early-return:" + Date.now() + ":booting=" + booting + ":launched=" + launched); return; }',
  )
  applied.push('diagnostics injected (DIAG=1)')
}

writeFileSync(clientPath, code, 'utf8')

console.log('HRINFO fork built at ' + forkDir)
for (const line of applied) console.log('  - ' + line)
console.log(`  lib/client.js = ${code.length} bytes`)

