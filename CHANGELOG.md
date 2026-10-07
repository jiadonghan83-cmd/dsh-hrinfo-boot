# Changelog

## 0.1.7

Full-mode finale, finalised:

- The SYSTEM banner is the finale brand element. It is retitled HRINFO SYSTEM at overlay
  mount — before the animation can reveal it — so the old text never paints (it used to
  flash first and be replaced a moment later). The big wordmark is hidden in full mode;
  simple mode keeps it.
- Simple mode is vertically centred again. The layout is chosen in JS by mode, because the
  :host([data-mode=simple]) stylesheet rule never matched AND broke the build: CSS_550C is
  serialised as a DOUBLE-QUOTED JS string, so a double quote anywhere in this CSS ends the
  string. Never put double quotes in this plugin CSS.
- No opening black screen: the upstream show keeps #app transparent for the first seconds;
  it is now shown from the first frame and the finale dims it to 35 %.
- Small windows no longer overlap: the wordmark is capped by viewport height as well
  (min(680px,80vw,52vh)), and the banner no longer collides with it.
- Unlock is one-shot and instant: a released flag disables the safety reveal listeners, the
  gate layer and boot layer are hidden instantly (transition/animation off), and the overlay
  is disposed 60 ms after acceptance — no fade window, so no stray wordmark paint and no
  need for a second submit.

Structural fixes that made the finale possible at all:

- The passcode panel lives in a durable .hrinfo-gate-layer. In full mode the upstream show
  removes .hrinfo-stage about two seconds in, which used to destroy the panel, make the
  finale unreachable and let the overlay dispose itself.
- That layer receives the wordmark and its stylesheets by MOVE (a clone left the original on
  screen too, showing two overlapping logos), and it is born hidden so no timer race can
  flash the logo or the panel during the log phase.
- The rain is not mounted at all until the finale in full mode, and mounts INSIDE the gate
  layer: a body-level canvas was hidden behind the overlay opaque backdrop.

Operational note:

- A hrinfo-boot.json whose password field is EMPTY makes the host inject gate=false. The
  splash then exits at the end with no rain and no panel (it looks like a broken finale but
  is an unarmed gate). Re-set it with src/set-code.mjs --set <code>.
## 0.1.6 — hotfix

**0.1.5 could lock you out; do not use it.** In 0.1.5 the wordmark and the passcode panel
were hidden for the first 30 s so the log phase would own the screen. When that reveal did
not land, the gate was unreachable and the screen stayed black with no visible input.

- `setStageVisible()` can now only ever REVEAL the gate — it no longer takes a "hide"
  argument at all, and the initial `setStageVisible(false)` is gone. There is no code path
  left in which the passcode panel is invisible.
- The full-mode finale is unchanged and still works: the rain element is not mounted until
  the finale, then the rain arrives and `#app` dims to 35 % while the panel stays on screen.
- Everything else from 0.1.5 (HRINFO branding, panel position, white-bar fix, aria-hidden)
  is included.

Rule kept for the graph and for future work: **no animation logic may make the gate
unreachable — reachability beats any visual nicety.**

## 0.1.5

### Full-mode finale

- **The rain now arrives at the end.** In full mode the rain element is no longer mounted at
  all until the finale (deferred mount), so the boot sequence is the terminal/firmware log
  and nothing else. When the 30 s watchdog ends the animation, the finale mounts the rain,
  dims `#app` to 35 % brightness and fades the HRINFO wordmark and the passcode panel back
  in: the same frame the simple mode shows, with the rain over it, held until unlock.
- **Phase visibility is driven by JS inline styles.** Every stylesheet-based attempt at
  hiding the wordmark \+ panel during the log phase failed to take effect on this overlay,
  while every JS-driven change worked. `setStageVisible()` now sets opacity/visibility
  directly on `.hrinfo-stage`.
- **The gate can never become unreachable.** A 33 s unconditional `setStageVisible(true)`
  is the hard safety net, and the locked state no longer hides the whole splash layer
  (`#boot`), which had also hidden the rain canvas mounted inside it.

### Earlier fixes rolled into this release

- **HRINFO branding**: the settings row reads `HRINFO 开机动画` with the caption
  `启动时播放 HRINFO 片头（基于 550C 开发）…`, and the full-mode log prefixes and device
  names are `[HRINFO]`, `[HRINFO-INFER]`, `HRINFO-ROOT`, `HRINFO-CTRL`, `NET HRINFO`.
- **Passcode position**: the panel sits in the lower third instead of covering the
  `SYSTEM IS REWRITTEN` banner, and it is no longer re-parented out of `.hrinfo-stage`.
- **No more blank white bars**: full mode ships the APP_MARKUP stylesheet whose global
  `input` rules out-specified the lock sheet's transparent background; the lock inputs are
  pinned back with `!important`.
- **aria-hidden** is dropped from the overlay root when the gate is shown, so the passcode
  field is reachable by assistive technology.

## 0.1.4

- The settings row is HRINFO-branded: `550C 开机动画` becomes `HRINFO 开机动画` and the
  caption now reads `启动时播放 HRINFO 片头（基于 550C 开发）；完整模式可用点击或 Esc 跳过动画。`,
  so the 550C lineage is stated instead of implied by the label.
- Fixed: with a passcode configured, **full mode could not be left at all**. The gate patch
  makes `finish()` return early while `record.locked` ("the splash must not retire until the
  host says yes"), which also turned the click handler, the Escape handler and the 30 s
  watchdog into no-ops — and the full show keeps painting over `.hrinfo-stage`, so the
  panel was unreachable. Now `ensureLockVisible()` checks whether the panel is actually on
  screen; if it is not, it retires the splash layer (`.hrinfo-lock-only #boot{display:none}`)
  and floats the panel on the shadow root (`:host>.hrinfo-lock-root`, z-index 3000). Escape
  and click call it, and a 3.2 s safety timer re-asserts the watchdog's promise that the
  splash can never strand the user. The gate itself stays armed: skipping ends the
  animation, never the lock.

## 0.1.3

- The rain is a backdrop again. `mountRain()` appends its canvas to `.boot-stage` with
  `z-index: 900` — inside the splash's stacking context, above the dark backdrop
  (`.hrinfo-bg`, 0) and below the wordmark (`.hrinfo-stage`, 1000) and the passcode cells
  (`.hrinfo-lock`, 1200). The previous revision mounted the canvas on `document.body` at
  `z-index: 2147483300` to outrank the overlay, which printed falling glyphs across the
  logo and the four cells.
- Verified on a live instance: canvas parent `boot-stage`, `position:absolute`,
  `z-index:900`, full-viewport 1440x900 rect, wordmark at 1000, backdrop at 0.

## 0.1.2

- The gate no longer depends on `DSH_HOME` being exported to the host process.
  `gate.mjs` resolves the home through a new `resolveHome()`, which falls back to
  DSH's own default (`~/.dsh`, the path `dsh-home-paths` resolves) when the variable
  is absent. A host started straight from a shell or a shortcut — `dsh web` with no
  `DSH_HOME` in the environment — now keeps the passcode panel instead of silently
  playing the splash through, which is what happened on a machine whose DSH was never
  launched by `restart-dsh.cmd`.
- `set-code --status` prints the resolved home rather than "DSH_HOME not set", and
  `writePassword` no longer throws when the variable is missing.
- Verified with `DSH_HOME` removed from the environment: the served index carries
  `globalThis["__dsh550cGate"] = true`, `POST /hrinfo-boot/unlock` returns 200 for the
  configured code and 401 WRONG PASSWORD for another one.

## 0.1.1

- The published tarball now carries everything needed to rebuild: `build.mjs`,
  `scripts/`, `assets/` and the vendored `vendor/550c.tgz`. `0.1.0` shipped only `lib/`,
  so an installed copy could not reproduce its own runtime files. Verified by extracting
  the tarball, deleting `lib/`, running `node build.mjs`, and confirming all four
  generated files come back byte-identical.

## 0.1.0

First release.

- HRINFO boot splash: pure-vector `Hrinfo` wordmark, red dot on the `i`, centred
  independently of the code panel.
- Falling-character rain behind the wordmark — letters and digits, canvas-rendered.
- Host-side passcode gate with a four-cell panel: auto-advance, backspace, paste
  distribution, auto-submit, wrong-code shake, in-memory throttling.
- The panel takes focus on load without a click, retrying across the splash transition
  and whenever the window regains focus.
- `Ctrl+Shift+L` re-locks over the running interface without replaying the splash.
- `set-code` CLI to set, change, clear, and inspect the code.
- No default code: with none set, the gate stays off, so a fresh install cannot lock
  anyone out.
