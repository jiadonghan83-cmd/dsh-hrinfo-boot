/**
 * Calibrate the wordmark: find the font-size at which "Hrinfo" renders at a
 * target ink width, using the same canvas `font` shorthand the metrics used.
 *
 * This replaces ratio guessing: it renders the run and measures ink directly,
 * then solves for the size.
 *
 * Usage: node calibrate.mjs <out.json>
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { connectCdp } from './cdp.mjs'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9335

const PAGE = `<!doctype html>
<meta charset="utf-8">
<body><script>
const SANS = "'Segoe UI', Arial, 'Helvetica Neue', Helvetica, sans-serif"
const HEI  = "'Microsoft YaHei', SimHei, 'Noto Sans SC', sans-serif"

function ctxFor(family, px, weight) {
  const c = document.createElement('canvas')
  c.width = 3000; c.height = 900
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'alphabetic'
  ctx.font = weight + ' ' + px + 'px ' + family
  return { ctx, w: c.width, h: c.height }
}

function inkBox(ctx, w, h, x0s, baseline) {
  const d = ctx.getImageData(0, 0, w, h).data
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1)
      if (d[(y * w + x) * 4] > 40) {
        if (x < x0) x0 = x; if (x > x1) x1 = x
        if (y < y0) y0 = y; if (y > y1) y1 = y
      }
  if (x1 < 0) return null
  return { x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, baseline }
}

/** Render a text run at the given size; return ink box + resolved font. */
window.__run = (family, px, weight, text) => {
  const { ctx, w, h } = ctxFor(family, px, weight)
  const baseline = 600
  ctx.fillText(text, 200, baseline)
  const resolved = ctx.font
  const box = inkBox(ctx, w, h, 200, baseline)
  return { resolved, box, baseline }
}

/** Column ink runs, used to separate the i dot from its stem. */
function colRuns(ctx, x, y0, y1) {
  const d = ctx.getImageData(x, y0, 1, y1 - y0 + 1).data
  const runs = []
  let start = -1
  for (let i = 0; i < y1 - y0 + 1; i += 1) {
    const on = d[i * 4] > 40
    if (on && start < 0) start = i
    if (!on && start >= 0) { runs.push([start + y0, i - 1 + y0]); start = -1 }
  }
  if (start >= 0) runs.push([start + y0, y1])
  return runs
}

/** Exact dot geometry of the glyph i at a given size. */
window.__iDot = (family, px, weight) => {
  const { ctx, w, h } = ctxFor(family, px, weight)
  const baseline = 600
  ctx.fillText('i', 200, baseline)
  const box = inkBox(ctx, w, h, 200, baseline)
  if (box === null) return null
  let best = null
  for (let x = box.x0; x <= box.x1; x += 1) {
    const runs = colRuns(ctx, x, box.y0, box.y1)
    if (runs.length !== 2) continue
    const gap = runs[1][0] - runs[0][1]
    if (gap < 2) continue
    if (best === null || gap > best.gap) best = { x, gap, dotBottom: runs[0][1], stemTop: runs[1][0] }
  }
  if (best === null) return { box, split: null }
  // dot ink horizontal extent, scanning only rows above the split
  let dx0 = 1e9, dx1 = -1
  const d = ctx.getImageData(0, 0, w, h).data
  for (let y = box.y0; y <= best.dotBottom; y += 1)
    for (let x = box.x0 - 6; x <= box.x1 + 6; x += 1)
      if (d[(y * w + x) * 4] > 40) { if (x < dx0) dx0 = x; if (x > dx1) dx1 = x }
  return {
    box,
    split: best,
    dot: { x0: dx0, x1: dx1, y0: box.y0, y1: best.dotBottom, w: dx1 - dx0 + 1, h: best.dotBottom - box.y0 + 1 },
  }
}

window.__ready = true
<\/script></body>`

const userDataDir = mkdtempSync(join(tmpdir(), 'hrinfo-cal-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=3000,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  let version = null
  for (let i = 0; i < 60; i += 1) {
    await sleep(200)
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) { version = await res.json(); break }
    } catch { /* retry */ }
  }
  if (version === null) throw new Error('chrome never came up')

  const browser = await connectCdp(version.webSocketDebuggerUrl)
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const page = await connectCdp(`ws://127.0.0.1:${PORT}/devtools/page/${targetId}`)
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  await page.send('Page.navigate', {
    url: 'data:text/html;charset=utf-8,' + encodeURIComponent(PAGE),
  })

  for (let i = 0; i < 60; i += 1) {
    await sleep(200)
    const res = await page.send('Runtime.evaluate', {
      expression: 'window.__ready === true', returnByValue: true,
    })
    if (res.result?.value === true) break
  }

  const run = async (family, px, weight, text) => {
    const res = await page.send('Runtime.evaluate', {
      expression: `window.__run(${JSON.stringify(family)}, ${px}, ${weight}, ${JSON.stringify(text)})`,
      returnByValue: true,
    })
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails))
    return res.result.value
  }

  const SANS = "'Segoe UI', Arial, 'Helvetica Neue', Helvetica, sans-serif"
  const HEI = "'Microsoft YaHei', SimHei, 'Noto Sans SC', sans-serif"

  // Measure at a reference size, then solve for the size that hits the target.
  const probe = await run(SANS, 100, 600, 'Hrinfo')
  const probeCjk = await run(HEI, 100, 700, '海润信息')

  const TARGET_LATIN = 623
  const latinSize = (TARGET_LATIN / probe.box.w) * 100
  const cjkSize = (TARGET_LATIN / probeCjk.box.w) * 100

  // per-glyph ink boxes AT THE SOLVED SIZES — layout is done from these, so no
  // advance/side-bearing guessing is involved.
  const glyphs = {}
  for (const ch of ['H', 'r', 'i', 'n', 'f', 'o']) {
    const one = await run(SANS, latinSize, 600, ch)
    glyphs[ch] = { box: one.box }
  }
  const cjk = {}
  for (const ch of ['海', '润', '信', '息']) {
    const one = await run(HEI, cjkSize, 700, ch)
    cjk[ch] = { box: one.box }
  }

  // i dot geometry at the solved size: scan columns for the dot/stem gap and
  // report the dot's own ink box, so the red circle can be placed exactly.
  const iDot = await (async () => {
    const res = await page.send('Runtime.evaluate', {
      expression: `window.__iDot(${JSON.stringify(SANS)}, ${latinSize}, 600)`,
      returnByValue: true,
    })
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails))
    return res.result.value
  })()

  const out = {
    generatedAt: new Date().toISOString(),
    /** Canvas x the glyphs were drawn at; layout needs it to convert ink -> text origin. */
    textOriginX: 200,
    probe: { latin: probe, cjk: probeCjk },
    resolvedFont: probe.resolved,
    solvedLatinSize: latinSize,
    solvedCjkSize: cjkSize,
    glyphs,
    cjkGlyphs: cjk,
    iDot,
  }
  writeFileSync(process.argv[2], JSON.stringify(out, null, 2), 'utf8')

  console.log('resolved canvas font :', probe.resolved)
  console.log('Hrinfo @100px ink w  :', probe.box.w, 'h', probe.box.h, '(ratio', (probe.box.w / probe.box.h).toFixed(2) + ')')
  console.log('海润信息 @100px ink w:', probeCjk.box.w, 'h', probeCjk.box.h)
  console.log('=> latin size        :', latinSize.toFixed(2))
  console.log('=> cjk size          :', cjkSize.toFixed(2))
  console.log('   i box @size       :', JSON.stringify(glyphs.i.box))
  console.log('   i dot @size       :', JSON.stringify(iDot))
  console.log('   latin ink @size   :', JSON.stringify((await run(SANS, latinSize, 600, 'Hrinfo')).box))
  console.log('   cjk ink @size     :', JSON.stringify((await run(HEI, cjkSize, 700, '海润信息')).box))

  browser.close()
  page.close()
} finally {
  chrome.kill()
}
