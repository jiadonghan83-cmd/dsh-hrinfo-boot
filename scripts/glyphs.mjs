/**
 * Extract glyph geometry for the HRINFO wordmark using headless Chrome.
 *
 * Emits, per glyph: the exact bitmap bounding box (from canvas ink extents) so the
 * final SVG can use <text> and stay pixel-consistent, plus for `i` the dot/stem
 * split and stem centre — the red dot is drawn from those numbers rather than
 * being pulled out of the glyph.
 *
 * Usage: node glyphs.mjs <outFile.json>
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { connectCdp } from './cdp.mjs'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9333

const PAGE = `<!doctype html>
<meta charset="utf-8">
<body><script>
const RAD = Math.PI / 180

function withCtx(family, px, weight, fn) {
  const c = document.createElement('canvas')
  c.width = 2000; c.height = 1400
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'alphabetic'
  ctx.font = weight + ' ' + px + 'px ' + family
  const m = ctx.measureText(fn)
  const baseline = 900
  ctx.fillText(fn, 200, baseline)
  return { ctx, m, baseline, width: c.width, height: c.height }
}

function inkBox(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (d[(y * w + x) * 4] > 40) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** Row runs in a single column: contiguous ink spans, top to bottom. */
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

/** Find the column inside the i stem with the cleanest dot/stem separation. */
function findSplit(ctx, box) {
  let best = null
  for (let x = box.x0; x <= box.x1; x += 1) {
    const runs = colRuns(ctx, x, box.y0, box.y1)
    if (runs.length !== 2) continue
    const gap = runs[1][0] - runs[0][1]
    if (gap < 4) continue
    const score = gap - Math.abs(x - (box.x0 + box.x1) / 2) * 0.01
    if (best === null || score > best.score) {
      best = { x, gap, dotBottom: runs[0][1], stemTop: runs[1][0], score }
    }
  }
  return best
}

function probe(family, px, weight, text) {
  const { ctx, m, baseline, width, height } = withCtx(family, px, weight, text)
  const box = inkBox(ctx, width, height)
  return {
    family, px, weight, text,
    advance: m.width,
    baseline,
    ascent: m.actualBoundingBoxAscent,
    descent: m.actualBoundingBoxDescent,
    box,
  }
}

window.__probe = (family, px, weight, text) => {
  const base = probe(family, px, weight, text)
  const out = { ...base }
  if (text === 'i') {
    const split = findSplit(withCtx(family, px, weight, 'i').ctx, base.box)
    out.split = split
    if (split !== null) {
      const { ctx, width, height } = withCtx(family, px, weight, 'i')
      const dotBox = inkBox(ctx, width, split.dotBottom + 1)
      out.dotBox = dotBox
      // stem centre sampled just below the split
      const sctx = withCtx(family, px, weight, 'i').ctx
      const runs = colRuns(sctx, split.x, base.box.y0, base.box.y1)
      out.stemCentreX = split.x
      out.runsAtSplit = runs
      // horizontal extent of the dot
      let dx0 = 1e9, dx1 = -1
      for (let y = base.box.y0; y <= split.dotBottom; y += 1) {
        const row = ctx.getImageData(0, y, width, 1).data
        for (let x = 0; x < width; x += 1) {
          if (row[x * 4] > 40) { if (x < dx0) dx0 = x; if (x > dx1) dx1 = x }
        }
      }
      out.dotSpanX = { x0: dx0, x1: dx1 }
    }
  }
  return out
}
window.__ready = true
<\/script></body>`

const userDataDir = mkdtempSync(join(tmpdir(), 'hrinfo-cdp-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    `--window-size=2000,1400`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  let targets = null
  for (let i = 0; i < 50; i += 1) {
    await sleep(200)
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      if (res.ok) {
        targets = await res.json()
        if (targets.some((t) => t.type === 'page')) break
      }
    } catch {
      // not up yet
    }
  }
  if (targets === null || !targets.some((t) => t.type === 'page')) {
    throw new Error('chrome devtools endpoint never became ready')
  }

  let browserWs = null
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) {
        browserWs = (await res.json()).webSocketDebuggerUrl
        break
      }
    } catch {
      // retry
    }
    await sleep(200)
  }
  if (browserWs === null) throw new Error('no browser webSocketDebuggerUrl')
  const browser = await connectCdp(browserWs)

  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const pageWs = `ws://127.0.0.1:${PORT}/devtools/page/${targetId}`
  const page = await connectCdp(pageWs)

  await page.send('Page.enable')
  await page.send('Runtime.enable')
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`
  await page.send('Page.navigate', { url: dataUrl })

  let ready = false
  for (let i = 0; i < 60; i += 1) {
    await sleep(200)
    const res = await page.send('Runtime.evaluate', {
      expression: 'window.__ready === true',
      returnByValue: true,
    })
    if (res.result?.value === true) {
      ready = true
      break
    }
  }
  if (!ready) throw new Error('measurement page never became ready')

  const evaluate = async (expression) => {
    const res = await page.send('Runtime.evaluate', { expression, returnByValue: true })
    if (res.exceptionDetails !== undefined) {
      throw new Error(`page exception: ${JSON.stringify(res.exceptionDetails)}`)
    }
    return res.result.value
  }

  const SANS = "'Segoe UI', Arial, 'Helvetica Neue', Helvetica, sans-serif"
  const HEI = "'Microsoft YaHei', SimHei, 'Noto Sans SC', sans-serif"

  const report = {
    generatedAt: new Date().toISOString(),
    sans: { family: SANS, size: 200, weight: 600 },
    hei: { family: HEI, size: 120, weight: 700 },
    latin: {},
    cjk: {},
  }

  for (const ch of ['H', 'r', 'i', 'n', 'f', 'o']) {
    report.latin[ch] = await evaluate(`window.__probe(${JSON.stringify(SANS)}, 200, 600, ${JSON.stringify(ch)})`)
  }
  for (const ch of ['海', '润', '信', '息']) {
    report.cjk[ch] = await evaluate(`window.__probe(${JSON.stringify(HEI)}, 120, 700, ${JSON.stringify(ch)})`)
  }

  const out = process.argv[2]
  writeFileSync(out, JSON.stringify(report, null, 2), 'utf8')
  console.log(`wrote ${out}`)
  for (const [k, v] of Object.entries(report.latin)) {
    console.log(`  latin ${k}: box=${JSON.stringify(v.box)} adv=${v.advance.toFixed(2)}`)
  }
  console.log(`  i.split=${JSON.stringify(report.latin.i.split)} dotSpanX=${JSON.stringify(report.latin.i.dotSpanX)}`)
  for (const [k, v] of Object.entries(report.cjk)) {
    console.log(`  cjk ${k}: box=${JSON.stringify(v.box)} adv=${v.advance.toFixed(2)}`)
  }

  browser.close()
  page.close()
} finally {
  chrome.kill()
}
