# Changelog

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
