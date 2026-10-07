# Changelog

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
