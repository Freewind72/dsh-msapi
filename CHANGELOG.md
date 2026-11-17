# Changelog

## 0.1.10

- **The player area's top edge is fixed; the drag handle is gone.** 0.1.2 added a 10px handle
  whose drag wrote the container's top clearance. Because the player docks near the bottom of
  that same container, pulling the edge past the player's own top edge took the player out of
  both painting and hit-testing — it simply vanished, and far enough down the immersive
  layer's close button went with it. The edge is now derived from the caption strip alone, and
  there is no handle, so nothing can be dragged over the player.
- Clearance is still re-measured on mount, on resize, and when fullscreen or the titlebar
  markers change.
- Diagnostics report the applied `topClear` value instead of whether a handle exists.

## 0.1.9

- Documentation rewritten from scratch, in two languages: `README.md` (English, the default) and
  `README.zh.md`. Both are organised the same way and cross-linked, so a reader can switch without
  losing their place.
- New `LICENSE`, now **MIT** (see below for why it changed twice in this cycle).
- The license is listed in `files`, so it travels with the published package.
- The test directory was removed in this release; `scripts.test` and `scripts.nobom` went with it.
- Install docs now use the `github:Freewind72/dsh-msapi` pnpm shorthand; `package.json` gained
  `repository`, `homepage` and `bugs` pointing at the GitHub repository, and a Chinese
  `description`.
- Icon: added `icon.svg` (declared via `package.json` `icon`), dropped the unused `icon.png`.
- **License history within this cycle**: started as a custom non-commercial text, then switched to
  PolyForm Noncommercial 1.0.0 to get a GitHub license badge, then to **MIT**. The badge chase was
  futile — GitHub's detection engine only matches the 47 permissive/copyleft templates in its
  database, which contain no noncommercial license at all, so any such license shows as "Other"
  regardless of format. MIT is now verbatim from the official template and `package.json` declares
  the `MIT` SPDX identifier.

## 0.1.8

Two review passes over the whole plugin. Five real defects, all fixed:

- **Deleted cookies came back.** The mirror sends the page's whole jar, but the host merged it into
  the stored copy, so a cookie the player had deleted lived on in `config.json` and reappeared on the
  next boot — the player's own `delCookie` (used when migrating its legacy cookies) never took
  effect. The write is now `replace`: what the page sends *is* the jar.
- **An empty jar was refused.** `sanitize({})` returned `null`, so clearing every cookie could never
  be stored. An empty object is a legitimate write now; only a body with no recognisable key is
  rejected.
- **The cookie cap dropped at random.** With more than 32 entries the excess was cut by insertion
  order, which follows whatever the player happened to write first — the state cookie could be the
  one thrown away. The cap now ranks by importance, keeping `mapi_state_*` and the consent answer.
- **Consent was never persisted on a first run.** `restorePlayerState` put `granted` into the jar by
  assigning it directly, leaving the dirty flag clear, so the very first launch kept it in memory
  only and asked again next time.
- **SSRF through the settings URL.** `probe()` fetches from the host process, which sits behind no
  proxy, so a request body could aim it at a cloud metadata endpoint and read the outcome back
  through `latencyMs` and `message`. Link-local (`169.254.*`, `fe80:*`) and unique-local (`fc00::/7`)
  addresses are refused now. Loopback and private ranges stay allowed on purpose: a self-hosted
  Msapi on `http://127.0.0.1:8080` is a supported setup.
- An unexpected 500 no longer returns the internal message to the page — it can hold a filesystem
  path or a stack fragment. The detail goes to the host log instead.
- **A BOM in `package.json` makes DSH reject the plugin outright.** The loader does a bare
  `JSON.parse(readFileSync(path, "utf8"))`, a BOM survives that read, and the throw is reported as an
  invalid package — with routes 404 and no other clue. It had crept in here. (A guard test was added
  with this release and removed again in 0.1.9; see that entry.)

## 0.1.7

- **Fixed the actual reason nothing was ever persisted: cookies do not work on `dsh-app://`.**
  DSH Desktop serves the UI over a custom scheme, and there `document.cookie` is inert — the
  assignment is silently ignored and the getter always returns `""`. A diagnostics report from a
  live page settled it: `href: "dsh-app://app/"`, an empty cookie jar, the player running. The port
  changing between launches was a red herring; the jar was empty within a single session too.
- The player's own cookie seam is now replaced: `MP._.setCookie` / `getCookie` / `delCookie` are
  redirected to an emulated jar. Every part of the player (`core/state.js`, `core/auth.js`,
  `core/theme.js`) already goes through those three, so they all keep working untouched. Values stay
  the player's own strings — it cannot tell this jar from a real one.
- The jar is restored from the host **before** the embed script is appended, because `loadState`
  reads it once while booting.
- `GET/PUT /dsh-msapi/state` now store the whole jar as a name→value map, so a cookie the player
  invents later is carried without a schema change. A `null` value deletes the entry, which honours
  the player's own `delCookie`.
- New `GET/PUT /dsh-msapi/diagnostics`: the browser reports what it observed — the scheme, whether
  real cookies work, the emulated jar's names, whether the bridge is installed, the last host call's
  status and body — into `diagnostics.json`. That report is what identified this bug.

## 0.1.6

> **Superseded diagnosis** — see the note under 0.1.5. The consent gate was real, but it was not what
> kept the jar empty; `document.cookie` was already inert on this scheme. The consent work it
> introduced still stands in 0.1.7.

- **Fixed: nothing was ever persisted, because the player never wrote a cookie to mirror.** The
  consent cookie (`mapi_cookie_consent`) is what `showConsentBanner` checks before letting the boot
  chain continue, and `api.php` runs `verifyKey → showConsentBanner(callback) → get-config` — so an
  unanswered banner does not merely switch persistence off, it stops the player from loading at all.
  Being host-only, that cookie died with the old port on every restart, which put the banner back
  each launch. The plugin now grants consent and writes the cookie **before** the embed script, so
  the banner never renders and `MP._cookieConsented` is never `false`.
- Consent is mirrored to the host as well and replayed on the next boot, so the answer survives the
  port change like the rest of the player's memory.
- A refused or failed mirror write now clears the "already sent" marker, so the next tick retries
  instead of silently concluding there was nothing to send.

## 0.1.5

> **Superseded diagnosis.** The explanation below — a changing port invalidating host-only cookies —
> was wrong. The real cause, found in 0.1.7, is that `document.cookie` does not work at all on the
> `dsh-app://` scheme the desktop shell serves the UI from. The mechanism introduced here (a durable
> copy in `config.json`, restored before boot) is still what 0.1.7 builds on; only the reason stated
> here is off. Kept as written so the record stays honest.

- **New: the player's memory now survives a DSH restart.** The player remembers itself in a cookie
  (`mapi_state_dsh-msapi`, written `path=/; max-age=31536000` with no `domain`), but the Web GUI
  listens on a port chosen at launch — `127.0.0.1:60472` one run, `127.0.0.1:58828` the next — and a
  host-only cookie belongs to one origin, port included. Every launch therefore started with an
  empty jar: volume, playback mode, last song and resume position were written and then never seen
  again. `localStorage` has the same origin scope and would not have helped.
- The durable copy lives in `config.json` now, owned by the host half. `GET/PUT /dsh-msapi/state`
  stores the player's own JSON unchanged, so its `loadState` cannot tell the difference.
- The browser half restores the cookie **before** the embed script is appended (the player reads its
  memory once, while booting) and mirrors later writes on a 5s tick plus `pagehide`, comparing first
  so requests track real changes rather than the player's twice-a-second rewrites.
- A snapshot the player could not parse, or one larger than a cookie could carry, is dropped rather
  than truncated — half a JSON document would fail on every boot.

## 0.1.4

- **Fixed: the lyric strip left a gap after the words and looked stretched.** Core sizes the
  strip as `width = span.scrollWidth + 42`; that 42 is `padding: 6px 20px` plus a 2px breath, and
  it only means the pill's *total* width under `box-sizing: border-box` — which Msapi's own
  stylesheet sets globally (`assets/css/pc.css`: `*, *::before, *::after`). Embedded in DSH the
  strip inherits no such reset, so the same number became a content width and 40px of padding was
  added on top: the pill painted `scrollWidth + 82` wide against `scrollWidth + 42` of text. The
  strip is now pinned to `border-box`, restoring the model its arithmetic was written for; the
  skin's own padding is left untouched.
- The strip is patched on every pass, so a strip created later (it is built lazily on the first
  lyric line) is caught too.

## 0.1.3

- **Fixed: the immersive player's close button was hidden under DSH's caption bar.** The viewport
  clips the caption strip, and the immersive layer started at `top: 0`, so its close button (which
  the skin puts in a 60px bar at the very top) was the first thing clipped away. The layer is now
  pushed down by the same clearance the viewport uses.
- The fix reaches into the player's `mode: "closed"` shadow tree, which no outside selector can
  target: the plugin appends one style element into the shadow root the player keeps on itself
  (`_hostRoot`), and rewrites a single rule whenever the clearance changes.
- The skin's own vertical padding is compensated rather than removed, so the close button lands
  where its author put it relative to the layer's new top edge.
- A newly booted player is polled briefly, because it inserts its host element before the instance
  object exists.

## 0.1.2

- **Fixed: the player no longer sits under the caption buttons.** The clearance was derived purely
  in CSS from `html[data-windows-titlebar]`; when that selector did not match, the entire
  `clip-path` was dropped and the player painted over the native minimise / maximise / close
  buttons. It is now measured in JavaScript from the same inline property DSH's preload writes
  (`--dsh-windows-titlebar-height`), with the marker attribute as a fallback, and applied inline on
  the container — no selector stands between the value and the clip any more.
- **New: the player area is draggable.** A 10px handle on the viewport's top edge moves the whole
  area down, out of the way of anything covering it, and follows the clearance through fullscreen
  changes.
- The clearance is re-measured when fullscreen is entered or left and on resize, instead of being
  read once at mount.

## 0.1.1

- **The viewport no longer covers DSH's caption bar.** The container is clipped from the top by
  DSH's own markers instead of a hardcoded number: `data-windows-titlebar` with
  `--dsh-windows-titlebar-height` (measured 40px) on Windows, a 48px strip on macOS, and zero
  clearance in fullscreen (`data-fullscreen`). `clip-path` rather than a `top` inset, so a dragged
  player cannot paint over the caption either.
- The player's toast layer is pushed below the caption bar. It is pinned at `top: 16px`, inside the
  clipped strip, so error messages would otherwise have been invisible.
- The docked player is lifted above the composer (96px) once, in JavaScript, instead of with an
  `!important` stylesheet rule — the rule would have won over the user's own drag.

## 0.1.0

First release.

- Settings → **Music Player** page with two inputs: site URL and API key. An empty URL means the
  official site `https://msapi.bmwy72.top`.
- `GET/PUT /dsh-msapi/settings`, `POST /dsh-msapi/probe`, `GET/PUT /dsh-msapi/player` on the host
  half; mutations require the GUI's signed session cookie.
- Saving probes `action=manifest` once and reports reachability, key state, playlist and song
  counts in a single status line. `verify-key` is deliberately avoided: Msapi rate limits it to
  five calls per minute per IP.
- Gateway discovery tries the remembered path, then `/admin/api/api.php`, then `/api/api.php`.
- The player is embedded with `<script src="<site>/api.php?key=…&data-player-id=dsh-msapi">` and
  moved into a plugin-owned viewport container whose `transform` makes it the containing block, so
  the player's full-screen layer covers that box instead of the whole window.
- Teardown destroys the player instance, removes its host element, its toast layer, the injected
  script and the viewport; a late-booting instance is swept for twelve seconds after teardown.
- Configuration lives in `$DSH_HOME/dsh-msapi/config.json` (mode 0600, atomic write, corrupt files
  moved aside). The key is never returned to the browser — only a SHA-256 fingerprint.
