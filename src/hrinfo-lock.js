/**
 * Password unlock layer for dsh-hrinfo-boot — browser half.
 *
 * Runs only when the host half reports that a password is configured. It freezes
 * the splash on its final frame and shows a four-cell code panel under the
 * wordmark; the main interface is only revealed once the host says yes.
 *
 * The candidate is POSTed to the host rather than compared here: a check in this
 * file would ship the password to every visitor and be bypassable in one line.
 *
 * Dependency-free and cancellable, matching the rest of the plugin.
 */

/** Code length. Must match gate.mjs CODE_LENGTH. */
const CODE_LENGTH = 4
/** Accepted characters. Must match gate.mjs CODE_PATTERN. */
const CODE_CHARS = /^[0-9A-Za-z]$/

/**
 * Build the unlock panel.
 *
 * @param options - `onSubmit(value)` performs the round trip and resolves to an
 *   outcome object; the rest are display-only.
 * @returns panel element, focus/dispose controls, and a way to report an outcome.
 */
export function createLockPanel(options) {
  const panel = document.createElement('form')
  panel.className = 'hrinfo-lock'
  panel.setAttribute('autocomplete', 'off')

  const cells = document.createElement('div')
  cells.className = 'hrinfo-lock-cells'

  /** One cell per code position; the value lives here, not in a hidden input. */
  const inputs = []
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    const cell = document.createElement('div')
    cell.className = 'hrinfo-lock-cell'
    cell.dataset.index = String(i)
    const input = document.createElement('input')
    input.className = 'hrinfo-lock-input'
    input.type = 'text'
    input.inputMode = 'text'
    input.maxLength = 1
    input.autocomplete = 'off'
    input.setAttribute('autocapitalize', 'off')
    input.setAttribute('spellcheck', 'false')
    input.setAttribute('aria-label', `Code digit ${i + 1}`)
    const caret = document.createElement('span')
    caret.className = 'hrinfo-lock-caret'
    cell.append(input, caret)
    cells.append(cell)
    inputs.push({ cell, input })
  }

  const submit = document.createElement('button')
  submit.className = 'hrinfo-lock-go'
  submit.type = 'submit'
  submit.textContent = options.submitLabel ?? 'UNLOCK'

  const status = document.createElement('div')
  status.className = 'hrinfo-lock-status'

  const actions = document.createElement('div')
  actions.className = 'hrinfo-lock-actions'
  actions.append(submit)

  panel.append(cells, actions, status)
  if (typeof options.hint === 'string' && options.hint !== '') {
    const hint = document.createElement('div')
    hint.className = 'hrinfo-lock-hint'
    hint.textContent = options.hint
    panel.append(hint)
  }

  let busy = false
  let disposed = false

  const value = () => inputs.map((entry) => entry.input.value).join('')

  const setActive = (index) => {
    for (let i = 0; i < inputs.length; i += 1) {
      inputs[i].cell.classList.toggle('is-active', i === index)
      inputs[i].cell.classList.toggle('is-filled', inputs[i].input.value !== '')
    }
  }

  const setStatus = (text, cls) => {
    status.textContent = text
    status.className = `hrinfo-lock-status${cls === undefined ? '' : ` ${cls}`}`
  }

  const focusAt = (index) => {
    const target = Math.max(0, Math.min(inputs.length - 1, index))
    inputs[target].input.focus()
    inputs[target].input.select()
    setActive(target)
  }

  /**
   * Keep the caret in the panel without the user having to click.
   *
   * A single `focus()` on the next animation frame is not enough: at that moment the
   * overlay may still be `pointer-events:none`, or the window itself may not yet be
   * focused, and a rejected focus() call is silent — nothing retries it, so the user
   * has to click the first cell. This focuses immediately, again on the next frame,
   * again after the splash transition has settled, and again whenever the window
   * regains focus.
   */
  const grabFocus = () => {
    if (disposed) return
    const empty = inputs.findIndex((entry) => entry.input.value === '')
    focusAt(empty < 0 ? inputs.length - 1 : empty)
  }

  const focusTimers = []
  const scheduleFocus = () => {
    window.requestAnimationFrame(() => { if (!disposed) grabFocus() })
    for (const delay of [60, 300, 900, 1600]) {
      focusTimers.push(
        window.setTimeout(() => { if (!disposed) grabFocus() }, delay),
      )
    }
  }
  const onWindowFocus = () => grabFocus()
  window.addEventListener('focus', onWindowFocus)

  const shake = () => {
    panel.classList.remove('hrinfo-lock-shake')
    // Force a reflow so removing and re-adding the class retriggers the animation.
    void panel.offsetWidth
    panel.classList.add('hrinfo-lock-shake')
  }

  /** Clear every cell and drop the caret back at the start. */
  const clear = (focus = true) => {
    for (const entry of inputs) entry.input.value = ''
    setStatus('')
    setActive(0)
    if (focus) focusAt(0)
    else for (const entry of inputs) entry.cell.classList.remove('is-filled')
  }

  const attempt = async () => {
    const candidate = value()
    if (candidate.length !== CODE_LENGTH) {
      setStatus('ENTER 4 CHARACTERS', 'bad')
      shake()
      // Send the caret to the first gap rather than making the user hunt for it.
      const gap = inputs.findIndex((entry) => entry.input.value === '')
      focusAt(gap < 0 ? 0 : gap)
      return
    }
    busy = true
    submit.disabled = true
    for (const entry of inputs) entry.input.disabled = true
    setStatus('VERIFYING…', 'busy')

    let outcome
    try {
      outcome = await options.onSubmit(candidate)
    } catch (error) {
      outcome = { ok: false, message: `ERROR: ${String(error && error.message)}` }
    }

    busy = false
    submit.disabled = false
    for (const entry of inputs) entry.input.disabled = false
    if (disposed) return

    if (outcome !== null && outcome.ok === true) {
      setStatus('ACCESS GRANTED', 'ok')
      panel.classList.add('hrinfo-lock-granted')
      for (const entry of inputs) entry.input.blur()
      return
    }
    clear()
    setStatus(outcome?.message ?? 'DENIED', 'bad')
    shake()
  }

  panel.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!busy && !disposed) void attempt()
  })

  for (let i = 0; i < inputs.length; i += 1) {
    const { input } = inputs[i]

    input.addEventListener('input', () => {
      // Keep only accepted characters: this field is a code, not free text.
      const typed = input.value.replace(/[^0-9A-Za-z]/g, '')
      input.value = typed.slice(-1)
      setActive(i)
      inputs[i].cell.classList.toggle('is-filled', input.value !== '')
      if (input.value !== '' && i < inputs.length - 1) focusAt(i + 1)
      setStatus('')
      // Auto-submit once the code is complete: four cells have no ambiguity left.
      if (value().length === CODE_LENGTH && !busy) window.setTimeout(() => { if (!busy && !disposed && value().length === CODE_LENGTH) void attempt() }, 120)
    })

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace') {
        if (input.value === '' && i > 0) {
          event.preventDefault()
          inputs[i - 1].input.value = ''
          inputs[i - 1].cell.classList.remove('is-filled')
          focusAt(i - 1)
        } else {
          input.value = ''
          inputs[i].cell.classList.remove('is-filled')
          setStatus('')
        }
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        focusAt(i - 1)
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        focusAt(i + 1)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        void attempt()
      }
    })

    // Paste a whole code into any cell and spread it across the row.
    input.addEventListener('paste', (event) => {
      const text = (event.clipboardData?.getData('text') ?? '').replace(/[^0-9A-Za-z]/g, '')
      if (text === '') return
      event.preventDefault()
      const chars = text.slice(0, CODE_LENGTH).split('')
      for (let k = 0; k < chars.length; k += 1) {
        inputs[k].input.value = chars[k]
        inputs[k].cell.classList.toggle('is-filled', true)
      }
      focusAt(Math.min(chars.length, inputs.length - 1))
      if (value().length === CODE_LENGTH && !busy) void attempt()
    })

    input.addEventListener('focus', () => setActive(i))
  }

  setActive(0)
  scheduleFocus()

  return {
    element: panel,
    focus: () => focusAt(0),
    clear,
    setStatus,
    dispose: () => {
      disposed = true
      for (const id of focusTimers) window.clearTimeout(id)
      focusTimers.length = 0
      window.removeEventListener('focus', onWindowFocus)
      panel.remove()
    },
  }
}

/** Stylesheet for the unlock panel, injected alongside it. */
export const LOCK_CSS = `
  .hrinfo-lock{display:flex;flex-direction:column;align-items:center;gap:14px;
    margin:30px auto 0;font-family:inherit;-webkit-user-select:none;user-select:none}

  /* Four cells, sized so the row reads as a code slot rather than a text box. */
  .hrinfo-lock-cells{display:flex;gap:12px}
  .hrinfo-lock-cell{position:relative;width:54px;height:66px;
    background:linear-gradient(180deg,rgba(6,12,24,.92),rgba(4,7,15,.92));
    border:1px solid var(--amber-d,#1f4d8f);
    box-shadow:inset 0 0 18px rgba(95,208,232,.06);
    transition:border-color .16s ease, box-shadow .16s ease, transform .16s ease}
  .hrinfo-lock-cell::before,.hrinfo-lock-cell::after{content:"";position:absolute;
    width:7px;height:7px;border-color:var(--amber,#5fd0e8);opacity:.5;pointer-events:none;
    transition:opacity .16s ease}
  .hrinfo-lock-cell::before{top:-1px;left:-1px;border-top:2px solid;border-left:2px solid}
  .hrinfo-lock-cell::after{bottom:-1px;right:-1px;border-bottom:2px solid;border-right:2px solid}
  .hrinfo-lock-cell.is-filled{border-color:rgba(95,208,232,.55)}
  .hrinfo-lock-cell.is-filled::before,.hrinfo-lock-cell.is-filled::after{opacity:.85}
  .hrinfo-lock-cell.is-active{border-color:var(--amber,#5fd0e8);transform:translateY(-1px);
    box-shadow:0 0 0 1px var(--amber-fade,rgba(95,208,232,.35)),
      0 0 22px rgba(95,208,232,.28),inset 0 0 22px rgba(95,208,232,.1)}
  .hrinfo-lock-cell.is-active::before,.hrinfo-lock-cell.is-active::after{opacity:1}

  .hrinfo-lock-input{width:100%;height:100%;padding:0;border:0;outline:none;
    background:transparent;text-align:center;caret-color:transparent;
    color:var(--amber-b,#9ae8f8);font-family:inherit;font-size:30px;font-weight:600;
    letter-spacing:0;text-shadow:0 0 10px rgba(95,208,232,.75);cursor:default}
  .hrinfo-lock-input:disabled{opacity:.55}
  /* Hide the real glyph as a filled disc; the caret still blinks while focused. */
  .hrinfo-lock-cell.is-filled .hrinfo-lock-input{-webkit-text-security:disc;text-security:disc;font-size:22px}

  .hrinfo-lock-caret{position:absolute;left:50%;bottom:9px;width:16px;height:2px;
    margin-left:-8px;background:var(--amber,#5fd0e8);opacity:0;
    box-shadow:0 0 8px rgba(95,208,232,.9)}
  .hrinfo-lock-cell.is-active .hrinfo-lock-caret{opacity:1;animation:hrinfoCaret 1.06s steps(1) infinite}
  @keyframes hrinfoCaret{0%,49%{opacity:1}50%,100%{opacity:0}}

  .hrinfo-lock-actions{display:flex;gap:8px;margin-top:2px}
  .hrinfo-lock-go{padding:9px 26px;background:rgba(4,7,15,.86);
    border:1px solid var(--amber-d,#1f4d8f);color:var(--amber,#5fd0e8);
    font-family:inherit;font-size:12px;letter-spacing:.24em;text-transform:uppercase;
    cursor:pointer;transition:background .18s ease, border-color .18s ease, color .18s ease}
  .hrinfo-lock-go:hover:not(:disabled){background:rgba(95,208,232,.14);
    border-color:var(--amber,#5fd0e8);color:var(--amber-b,#9ae8f8);
    box-shadow:0 0 18px rgba(95,208,232,.22)}
  .hrinfo-lock-go:disabled{opacity:.5;cursor:default}

  .hrinfo-lock-status{min-height:1.25em;font-size:11px;letter-spacing:.24em;
    text-transform:uppercase;color:var(--text-faint,#2f4666);transition:color .16s ease}
  .hrinfo-lock-status.bad{color:var(--red,#e02020);text-shadow:0 0 10px rgba(224,32,32,.55)}
  .hrinfo-lock-status.ok{color:var(--green,#b8c840);text-shadow:0 0 12px rgba(184,200,64,.6)}
  .hrinfo-lock-status.busy{color:var(--amber,#5fd0e8)}
  .hrinfo-lock-hint{font-size:11px;letter-spacing:.1em;color:var(--text-faint,#2f4666)}

  .hrinfo-lock-shake{animation:hrinfoShake .34s cubic-bezier(.36,.07,.19,.97)}
  @keyframes hrinfoShake{
    10%,90%{transform:translateX(-2px)} 20%,80%{transform:translateX(4px)}
    30%,50%,70%{transform:translateX(-7px)} 40%,60%{transform:translateX(7px)}
  }
  /* A brief bloom on success, so the unlock reads even at a glance. */
  .hrinfo-lock-granted .hrinfo-lock-cell{border-color:var(--green,#b8c840);
    box-shadow:0 0 26px rgba(184,200,64,.42),inset 0 0 22px rgba(184,200,64,.16)}
  .hrinfo-lock-granted .hrinfo-lock-caret{opacity:0;animation:none}

  /* The gate must end on an OPAQUE overlay.
   *
   * The out class declares opacity 0, so merely adding a class that also sets
   * opacity 1 loses the tie-break and leaves the host mid-fade (measured at 0.48),
   * with the interface showing through the panel.
   *
   * Instead the lock re-declares the host's own transition with a 700ms delay, and
   * declares opacity only in the out state: the fade-to-background plays, then the
   * delayed transition lands on opacity 1 and pins it there. Without the out class
   * nothing here sets opacity, so an unlocked splash fades normally. */
  .dsh550c-host.hrinfo-locked{transition:opacity 420ms cubic-bezier(.4,0,.2,1) 700ms !important}
  .dsh550c-host.hrinfo-locked.dsh550c-out{opacity:1}
`
