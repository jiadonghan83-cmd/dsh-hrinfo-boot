# dsh-hrinfo-boot

An HRINFO-branded boot splash for the DSH Web GUI, with an unlock gate.

The splash draws a pure-vector **Hrinfo** wordmark (the dot on the `i` is red) over a
falling-character rain, and holds the interface behind a four-cell passcode panel until
the right code is typed. Nothing is loaded from the network and nothing is written
outside `$DSH_HOME`.

## Install

```bash
# from GitHub (recommended — lib/ ships prebuilt, so pnpm never runs a build)
dsh plugin --profile web add github:jiadonghan83-cmd/dsh-hrinfo-boot
# pin the released version
dsh plugin --profile web add github:jiadonghan83-cmd/dsh-hrinfo-boot#v0.1.2
```

Then set an unlock code and restart DSH:

```bash
node node_modules/dsh-hrinfo-boot/src/set-code.mjs 7k2p
```

```bash
dsh --profile web
```

The plugin ships **prebuilt**. `dsh plugin add` runs pnpm, and pnpm blocks `prepare`
scripts on git-hosted packages until they are allowlisted, so a plugin that has to build
at install time fails for most people. `lib/` is committed instead.

### Installing from a directory or tarball

```bash
dsh plugin --profile web add /path/to/dsh-hrinfo-boot
dsh plugin --profile web add /path/to/dsh-hrinfo-boot-0.1.2.tgz
```

## The unlock code

There is **no default code**. With no code set the gate is off and the splash plays
straight through — that is deliberate, so a fresh install can never lock anyone out.

The code is four characters from `[0-9A-Za-z]`. It is never stored in plaintext: the host
writes a PBKDF2-SHA512 record (210,000 iterations, 64-byte key, per-install random salt)
to `$DSH_HOME/hrinfo-boot.json`, and comparison is constant-time.

```bash
node src/set-code.mjs 7k2p        # set or change the code
node src/set-code.mjs --status    # is a code set?
node src/set-code.mjs --clear     # turn the gate off
node src/set-code.mjs 7k2p --home /custom/dsh/home
```

Five wrong attempts start a lockout of 30 s, doubling per further failure up to 5 min.
The counter is in memory, so restarting DSH clears it — an acceptable trade for not
writing to disk on every bad guess.

### Locking again without restarting

Press **Ctrl+Shift+L** to re-lock. The splash does not replay; the panel simply returns
over the running interface.

### Recovering from a forgotten code

```bash
node src/set-code.mjs --clear
```

Or delete `$DSH_HOME/hrinfo-boot.json` and restart.

## What this is not

**The gate is not a security boundary.** DSH's own `/api/*` routes belong to the
`dsh-client-connection` service, and a plugin cannot register ahead of them, so anyone
holding the DSH token can reach the API without ever seeing this lock. Treat it as a
screen lock for an unattended machine, not as access control. DSH binds `127.0.0.1` by
default, which is the boundary that actually matters.

## How it works

The splash hook is DSH's own extension point. The host half registers a row on
`webserver/index-inject`, which is the same mechanism DSH's theme and client-module
services use, so the first frame is painted while the document is still parsing and DSH's
own boot card never appears. The client half then mounts the stage in a shadow root on
the same task that retires that cover.

A few details are load-bearing and are easy to break when editing:

- **The rain canvas is a child of `document.body`, not of the overlay.** Measured, the
  same canvas composites 1,024,000 pixels from the body and 618 pixels from inside the
  overlay's shadow root, with no clipping anywhere in its ancestor chain. The overlay
  subtree suppresses canvas compositing; SVG text in the same subtree is unaffected, which
  is why the wordmark always rendered while the rain did not.
- **The canvas sets `width`/`height` in CSS explicitly.** A canvas is a replaced element:
  without a CSS size it lays out at 300x150 whatever its positioning, so the composited
  element stops being the element being measured.
- **The canvas carries an inline `z-index`.** A positioned element with `z-index:auto`
  resolves to 0 and is painted under any positioned sibling with a real z-index — in this
  case the overlay at `2147483000`.
- **The overlay's `:host{background}` is overridden inside the shadow sheet.** `--bg` is
  declared on `:host`, and shadow-host declarations are lifted into the outer tree, so a
  document-level override loses to it however specific it is.
- **The wordmark beats `.boot-stage svg{width:min(680px,90vw)}`** with `!important`; that
  ported rule out-specifies a single-class selector and otherwise pins the lockup left.
- **The code panel is focused on a schedule**, not once: a `focus()` call during the
  splash transition can be silently rejected when the overlay is still
  `pointer-events:none`, and nothing retries it.

## Rebuilding

`lib/` is generated from a patch of [`dsh-550c-boot`](https://github.com/yannicksong0106/dsh-550c-boot)
0.3.3, so the upstream tarball is vendored at `vendor/550c.tgz`:

```bash
node build.mjs           # regenerate lib/
node build.mjs --check   # fail if lib/ is stale
npm run verify           # syntax checks + build reproducibility
```

`build.mjs` refuses to copy a generated file that does not parse, and `--check` compares
byte-for-byte against a fresh build.

## Layout

```
lib/           generated runtime — host half, client bundle, gate, CLI
src/           sources the patch injects; never shipped as-is
scripts/       the patch and the logo builder
assets/        the generated logo SVG the patch embeds
vendor/        550c.tgz, the pristine upstream package
```

## Credits and licence

MIT. See `LICENSE`.

The splash is a derivative of [`dsh-550c-boot`](https://github.com/yannicksong0106/dsh-550c-boot)
0.3.3 by Ziyang Song, whose MIT notice is preserved verbatim in
`license/550c-boot-LICENSE`. That project in turn credits
[Voidpoket](https://github.com/Voidpoket) for the 550C title-animation HTML this stage
descends from.

The falling-character rain is an independent implementation of techniques studied from
[`glyph-rain`](https://github.com/Toskan4134/glyph-rain) (MIT): screen-unit trail length
and speed, many drops per lane spaced by a gap, contiguous trail rendering, a grid-wide
charset with per-cell churn, and the wordmark-reveal mask. No code was copied from it.
