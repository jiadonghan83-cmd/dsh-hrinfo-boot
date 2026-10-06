/**
 * Emit the HRINFO wordmark as SVG markup.
 *
 * Layout is done entirely from measured INK boxes (calib.json): each glyph is
 * placed so its own ink lands where we want it, which avoids advance/side-bearing
 * guesswork.
 *
 * Composition is the wordmark alone. The red mark is the dot of the `i`: the
 * glyph's own dot is covered by drawing a red circle over it, slightly larger so
 * it cannot peek.
 *
 * Usage: node logo.mjs <calib.json> <out.svg>
 */
import { readFileSync, writeFileSync } from 'node:fs'

const cal = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const out = process.argv[3]
const r = (n) => Math.round(n * 100) / 100

const LATIN_FS = cal.solvedLatinSize
const BASE = cal.glyphs.H.box.baseline // shared source baseline

const LATIN = ['H', 'r', 'i', 'n', 'f', 'o']

/* ---------- viewBox ---------- */
// The first glyph's ink starts exactly at PAD_X and the run spans TARGET_W, so the
// lockup fills the viewBox edge to edge. Extra horizontal padding would offset the
// whole wordmark inside its own box and make it render off-centre.
const PAD_X = 0
const TARGET_W = 700
const PAD_TOP = 26
const PAD_BOTTOM = 24

/* ---------- horizontal layout from ink boxes ---------- */
/**
 * Place glyphs edge to edge with equal ink gaps so that
 * (first ink left) -> (last ink right) spans exactly TARGET_W.
 */
function layoutInk(src, chars) {
  const boxes = chars.map((ch) => cal[src][ch].box)
  const naturalW = boxes.reduce((sum, b) => sum + b.w, 0)
  const gap = Math.max(0, (TARGET_W - naturalW) / (chars.length - 1))
  const placed = []
  let cursor = 0
  chars.forEach((ch, i) => {
    placed.push({ ch, inkLeft: cursor, box: boxes[i] })
    cursor += boxes[i].w + gap
  })
  return { placed, gap }
}

const LG = layoutInk('glyphs', LATIN)

/**
 * `<text x>` is the PEN origin of the glyph, while the layout is expressed in ink
 * edges. The canvas drew every glyph at a known pen origin, so the pen offset is
 * the difference between that origin and the ink box left — NOT box.x0 itself,
 * which is an absolute canvas coordinate.
 */
const ORIGIN = cal.textOriginX
const textX = (entry, pad) => r(pad + entry.inkLeft - (entry.box.x0 - ORIGIN))

/* ---------- vertical ---------- */
const latinTopSrc = Math.min(...LATIN.map((ch) => cal.glyphs[ch].box.y0))
const latinBottomSrc = Math.max(...LATIN.map((ch) => cal.glyphs[ch].box.y1))
const latinBaseline = r(PAD_TOP + (BASE - latinTopSrc))

const VIEW_W = r(PAD_X * 2 + TARGET_W)
const VIEW_H = r(latinBaseline + (latinBottomSrc - BASE) + PAD_BOTTOM)

/** Canvas y -> viewBox y: both axes point down, so this is a translation. */
const SVG_Y = (canvasY) => r(canvasY + (latinBaseline - BASE))

/* ---------- red dot ---------- */
const iEntry = LG.placed.find((p) => p.ch === 'i')
const d = cal.iDot.dot
const dotOffsetInI = (d.x0 + d.x1) / 2 - iEntry.box.x0
const dotCx = r(PAD_X + iEntry.inkLeft + dotOffsetInI)
const dotCy = SVG_Y((d.y0 + d.y1) / 2)
const dotR = r((Math.max(d.w, d.h) / 2) * 1.08)

/* ---------- emit ---------- */
const latinTexts = LG.placed
  .map((e) => `    <text x="${textX(e, PAD_X)}" y="${latinBaseline}">${e.ch}</text>`)
  .join('\n')

const svg = `<svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg" class="hrinfo-logo">
  <style>
    .hrinfo-logo text{font-family:var(--hr-font,'Segoe UI',Arial,'Helvetica Neue',Helvetica,sans-serif);font-weight:600}
    .hrinfo-word text{font-size:${r(LATIN_FS)}px;fill:var(--hr-word,#eef4ff)}
    .hrinfo-red{fill:var(--hr-red,#e02020)}
  </style>
  <g class="hrinfo-word">
${latinTexts}
  </g>
  <circle class="hrinfo-red" cx="${dotCx}" cy="${dotCy}" r="${dotR}"/>
</svg>
`

writeFileSync(out, svg, 'utf8')

const meta = {
  viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
  width: VIEW_W,
  height: VIEW_H,
  latinFontSize: r(LATIN_FS),
  latinBaselineY: latinBaseline,
  inkLeft: PAD_X,
  inkRight: r(PAD_X + TARGET_W),
  latinGap: r(LG.gap),
  redDot: { cx: dotCx, cy: dotCy, r: dotR },
}
writeFileSync(out.replace(/\.svg$/, '.json'), JSON.stringify(meta, null, 2), 'utf8')
console.log(JSON.stringify(meta, null, 2))
