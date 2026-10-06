/**
 * HRINFO falling-character rain.
 *
 * Rewritten using the techniques from glyph-rain (github.com/Toskan4134/glyph-rain,
 * MIT), studied from its source rather than depended on: it is a dependency-free
 * canvas effect, and the parts worth learning were the ones this module kept getting
 * wrong. No code was copied; the six techniques below were reimplemented.
 *
 * What was adopted, and why:
 *
 *   1. THE CANVAS MUST BE TOLD TO FILL ITS BOX. A canvas is a replaced element: with
 *      no CSS size it lays out at its attribute size, 300x150, however it is
 *      positioned. Earlier versions here sized the backing store but only set
 *      `position`/`inset`, so the element the browser composited was not the element
 *      being measured — pixels were provably drawn and nothing appeared on screen.
 *      `width:100%`/`height:100%` are now set explicitly.
 *
 *   2. ONE FULL REDRAW PER FRAME instead of surgical per-cell clearing. Clearing only
 *      the cells that changed is cheaper, but any skipped or re-rolled cell leaves a
 *      hole and the trail reads as dashes. The frame is cleared and repainted whole,
 *      throttled to FPS.
 *
 *   3. A LANE HOLDS MANY DROPS, spaced by `gap`. One drop per column is what made the
 *      rain fall in visible waves; a lane carrying as many drops as fit is what makes
 *      it continuous.
 *
 *   4. TRAIL LENGTH AND SPEED IN SCREEN UNITS, not rows: `length` is a fraction of the
 *      lane span and `speed` is cells per second, so the effect is identical at any
 *      viewport size.
 *
 *   5. TRAILS ARE DRAWN AS A CONTIGUOUS RUN (`head - i`), never as "the cells that
 *      changed since the previous frame".
 *
 *   6. THE CHARSET IS ONE ARRAY OVER THE WHOLE GRID with per-cell churn times, so a
 *      glyph persists and mutates in place instead of being owned by a drop.
 *
 * The wordmark reveal is adopted too: the logo is rasterised to a mask and sampled per
 * cell, and drops crossing a masked cell are drawn bright and steady while the rest of
 * the rain stays dim. That is what makes the mark readable through the rain.
 */

/**
 * Uppercase letters and digits.
 *
 * Katakana reads as Matrix pastiche but says nothing about this product, and every
 * glyph here is guaranteed to exist in any monospace fallback, so nothing can render as
 * a missing-glyph box. The mix is weighted toward letters so runs read as data rather
 * than as numbers.
 */
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Grid cell in px; also the glyph size. */
const CELL = 24
/** Full-frame redraw rate. The frame is fully repainted, so this is the cost knob. */
const FPS = 30
/** Character changes per second, per cell. */
const CHURN = 3
/** Trail length as a fraction of the lane span. */
const LENGTH = 0.2
const LENGTH_RANDOM = 0.6
/** Cells crossed per second, so speed does not change with the viewport. */
const SPEED = 26
const SPEED_RANDOM = 0.45
/** Distance between consecutive drops of one lane, in lane spans. Lower = denser. */
const GAP = 0.95
const GAP_RANDOM = 0.6
/** Trail colour steps, precomputed once. */
const RAMP = 16
/** Mask alpha at or below this is not part of the glyph. */
const MASK_ALPHA = 60

/**
 * Opacity of the trail, head to tail.
 *
 * These are deliberately high. Measured at 0.9/0.55 the layer was composited but
 * unreadable: 5.5% of the canvas carried ink, spread as thin strokes over ~27k cells
 * at an average alpha of 0.34, which on a near-black ground reads as texture rather
 * than as characters. "Painted" and "legible" are different bars and only the second
 * one is the requirement.
 */
const HEAD_ALPHA = 1
const TAIL_ALPHA = 0.34
/** Cells whose glyph falls inside the wordmark mask. */
const MARK_HEAD_ALPHA = 1
const MARK_TAIL_ALPHA = 0.75

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const jitter = (v, r) => v * (1 + (Math.random() * 2 - 1) * r)

/**
 * Resolve any CSS colour to [r, g, b] by letting the browser parse it, rather than
 * carrying a colour parser.
 */
const parseColor = (() => {
  let ctx = null
  return (value) => {
    if (ctx === null) ctx = document.createElement('canvas').getContext('2d')
    ctx.fillStyle = '#000000'
    ctx.fillStyle = value
    const s = ctx.fillStyle
    if (s[0] === '#') return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16))
    return (s.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number)
  }
})()

/**
 * Mount the rain layer inside `stage`.
 * @param stage - element to attach the canvas to, and the source of the colour vars.
 * @param options - `force` bypasses the reduced-motion check; `revealText` shapes the
 *   rain into that word.
 * @returns dispose function.
 */
export function mountRain(stage, options = {}) {
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (options.force !== true && reduced) return () => {}

  const readVar = (name, fallback) => {
    const value = getComputedStyle(stage).getPropertyValue(name).trim()
    return value === '' ? fallback : value
  }
  const from = parseColor(readVar('--rain', '#3f96e0'))
  const to = parseColor(readVar('--rain-head', '#ffffff'))
  const fontFamily = readVar('--rain-font', "ui-monospace, 'Courier New', Consolas, monospace")
  const css = (c) => 'rgb(' + c.map((v) => clamp(Math.round(v), 0, 255)).join(',') + ')'
  /** Head to tail: index 0 is the head. */
  const ramp = Array.from({ length: RAMP }, (_, i) => {
    const t = i / (RAMP - 1)
    return css(to.map((v, k) => v + (from[k] - v) * t))
  })
  const hot = css(to)
  /** Shadow colour for the glyph glow: the head colour at low alpha. */
  const glow = 'rgba(' + to.map((v) => clamp(Math.round(v), 0, 255)).join(',') + ',0.55)'

  const canvas = document.createElement('canvas')
  canvas.className = 'hrinfo-rain'
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    pointerEvents: 'none',
    // Must outrank the overlay, which is `position:fixed` with
    // `z-index:2147483000 !important`. A positioned element with `z-index:auto`
    // resolves to 0 and is painted under any positioned sibling that has a real
    // z-index, so without this the rain sits behind the overlay and is only glimpsed
    // as the overlay fades out — which is exactly how it was reported.
    zIndex: '2147483300',
    // Load-bearing: without an explicit CSS size a canvas lays out at 300x150 whatever
    // its positioning, so the composited element is not the one being measured.
    width: '100%',
    height: '100%',
  })
  // Appended to the DOCUMENT BODY, not into the overlay.
  //
  // Measured: this same canvas, filled flat, composites 1,024,000 pixels from the body
  // and 618 pixels from inside the overlay's shadow root. The element reports a
  // full-viewport box with no clipping anywhere in its ancestor chain, yet only a sliver
  // reaches the screen, so the overlay subtree is what suppresses it. SVG text in that
  // same subtree renders fine (the wordmark), which is why the rain is the only layer
  // that ever went missing.
  document.body.appendChild(canvas)

  const ctx = canvas.getContext('2d')
  if (ctx === null) return () => {}

  // The reveal mask is rasterised offscreen with plain fillText rather than by loading
  // the logo file, so there is no image decode, no CORS and no async step.
  const layer = document.createElement('canvas')
  const lctx = layer.getContext('2d')

  let cols = 0
  let rows = 0
  let span = 0
  let cell = CELL
  let chars = []
  let churnAt = null
  let churnRate = null
  let mask = null
  let lanes = []
  let raf = 0
  let last = 0

  const randChar = () => CHARSET[(Math.random() * CHARSET.length) | 0]
  const font = () => Math.round(cell * 0.9) + 'px ' + fontFamily

  const buildMask = () => {
    mask = null
    const w = canvas.width
    const h = canvas.height
    lctx.clearRect(0, 0, w, h)
    const text = options.revealText
    if (typeof text !== 'string' || text === '') return

    const size = Math.round(Math.min(w / (text.length * 0.66), h * 0.42))
    lctx.font = '600 ' + size + 'px ' + fontFamily
    lctx.textAlign = 'center'
    lctx.textBaseline = 'middle'
    lctx.fillStyle = '#ffffff'
    lctx.fillText(text, w / 2, h / 2)
    const data = lctx.getImageData(0, 0, w, h).data
    lctx.clearRect(0, 0, w, h)
    lctx.textAlign = 'start'
    lctx.textBaseline = 'top'

    const next = new Uint8Array(cols * rows)
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x = Math.min(w - 1, c * cell + (cell >> 1))
        const y = Math.min(h - 1, r * cell + (cell >> 1))
        if (data[(y * w + x) * 4 + 3] > MASK_ALPHA) next[r * cols + c] = 1
      }
    }
    mask = next
  }

  const newDrop = (at) => ({
    units: clamp(jitter(LENGTH, LENGTH_RANDOM), 0.02, 1),
    speed: Math.max(1, jitter(SPEED, SPEED_RANDOM)),
    travel: at,
  })

  /**
   * A lane holds as many drops as fit: the next leaves once the previous covered its
   * gap. One drop per lane is what made earlier versions fall in waves.
   */
  const spawn = (lane, at) => {
    lane.drops.push(newDrop(at))
    lane.gap = clamp(jitter(GAP, GAP_RANDOM), 0.05, 5) * span
  }

  const resize = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth || stage.getBoundingClientRect().width))
    const h = Math.max(1, Math.round(canvas.clientHeight || stage.getBoundingClientRect().height))
    canvas.width = w
    canvas.height = h
    layer.width = w
    layer.height = h

    cell = CELL
    cols = Math.ceil(w / cell)
    rows = Math.ceil(h / cell)
    span = rows

    const n = cols * rows
    chars = new Array(n)
    churnAt = new Float64Array(n)
    churnRate = new Float32Array(n)
    const now = performance.now()
    for (let i = 0; i < n; i += 1) {
      chars[i] = randChar()
      churnRate[i] = Math.max(0, jitter(CHURN, 0.5))
      churnAt[i] = churnRate[i] === 0 ? Infinity : now + (Math.random() * 1000) / churnRate[i]
    }

    // Lanes keep their drops across a resize, so a resize does not restart the rain.
    const old = lanes
    lanes = Array.from({ length: cols }, (_, i) => old[i] || { i, drops: [], gap: 0 })
    for (const lane of lanes) if (lane.drops.length === 0) spawn(lane, -Math.random() * span)

    buildMask()
  }

  const draw = () => {
    const w = canvas.width
    const h = canvas.height
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.font = font()
    ctx.textBaseline = 'top'
    // A glow is what makes the strokes read at a glance instead of as fine texture.
    ctx.shadowColor = glow
    ctx.shadowBlur = Math.round(cell * 0.55)

    for (const lane of lanes) {
      for (const d of lane.drops) {
        const len = Math.max(1, Math.round(d.units * span))
        const head = Math.round(d.travel)
        // The trail is a contiguous run behind the head. Drawing only "the cells that
        // changed" leaves dashes; this cannot.
        for (let i = 0; i < len; i += 1) {
          const pos = head - i
          if (pos < 0 || pos >= span) continue
          const idx = pos * cols + lane.i
          const onWordmark = mask !== null && mask[idx] === 1
          const fade = 1 - i / len
          ctx.globalAlpha = onWordmark
            ? MARK_TAIL_ALPHA + fade * (MARK_HEAD_ALPHA - MARK_TAIL_ALPHA)
            : TAIL_ALPHA + fade * (HEAD_ALPHA - TAIL_ALPHA)
          ctx.fillStyle = onWordmark ? hot : ramp[Math.min(RAMP - 1, ((i / len) * RAMP * 2) | 0)]
          ctx.fillText(chars[idx], lane.i * cell, pos * cell)
        }
      }
    }
    ctx.globalAlpha = 1
    ctx.shadowBlur = 0
  }

  const frame = (time) => {
    raf = window.requestAnimationFrame(frame)
    const elapsed = time - last
    if (elapsed < 1000 / FPS) return
    const dt = Math.min(0.1, elapsed / 1000) || 0
    last = time

    // Churn: a glyph persists and mutates in place instead of belonging to a drop.
    for (let i = 0; i < churnAt.length; i += 1) {
      if (time < churnAt[i]) continue
      churnAt[i] = time + 1000 / churnRate[i]
      chars[i] = randChar()
    }

    for (const lane of lanes) {
      const drops = lane.drops
      const tail = drops[drops.length - 1]
      if (tail === undefined) spawn(lane, -Math.random() * span)
      else if (tail.travel >= lane.gap) spawn(lane, 0)

      for (let k = drops.length - 1; k >= 0; k -= 1) {
        const d = drops[k]
        d.travel += d.speed * dt
        if (Math.round(d.travel) - d.units * span > span) drops.splice(k, 1)
      }
    }

    draw()
  }

  resize()
  raf = window.requestAnimationFrame(frame)

  const onResize = () => resize()
  window.addEventListener('resize', onResize)

  return () => {
    if (raf !== 0) window.cancelAnimationFrame(raf)
    raf = 0
    window.removeEventListener('resize', onResize)
    canvas.remove()
    layer.width = 0
    layer.height = 0
  }
}
