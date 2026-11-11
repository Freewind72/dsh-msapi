/**
 * dsh-msapi — durable memory for the embedded player.
 *
 * The player keeps everything in `document.cookie` (`core/state.js` writes
 * `mapi_state_<instance>`; `core/auth.js` reads `mapi_cookie_consent` first and
 * refuses to boot without an answer). Inside DSH Desktop the page is served over
 * a custom `dsh-app://` scheme, and **cookies do not work there at all**: the
 * assignment is silently ignored and the getter always returns an empty string.
 * Measured — a live page reported `href: "dsh-app://app/"` with `cookies: []`
 * while the player was running and had asked for consent.
 *
 * So the cookie jar is emulated. The host half keeps a name→value map in
 * `config.json`; the browser half loads it before the player boots and mirrors
 * changes back. `MP._.setCookie` / `getCookie` / `delCookie` are replaced, which
 * is the seam every part of the player already goes through, so `state.js`,
 * `auth.js` and `theme.js` all keep working without being touched.
 *
 * Values are the player's own strings, unchanged, so its `loadState` cannot tell
 * the difference between this jar and a real one.
 *
 * @module dsh-msapi/player-state
 */

/** Longest single value kept, matching what a cookie could carry anyway. */
const MAX_VALUE_LENGTH = 4096;

/** Most cookies kept, so a runaway writer cannot grow the file without bound. */
const MAX_COOKIES = 32;

/** A cookie name has to look like one. */
const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * Whether a name/value pair may be stored.
 *
 * An over-long value is dropped rather than truncated: half a JSON document is
 * worse than none, because the player would fail to parse it on every boot.
 *
 * @param {unknown} name cookie name.
 * @param {unknown} value cookie value.
 * @returns {boolean} whether the pair is storable.
 */
function storable(name, value) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) return false;
  if (typeof value !== 'string' || value.length > MAX_VALUE_LENGTH) return false;
  return true;
}

/** Names that must survive the cap, ordered by importance. */
const PRIORITY = [/^mapi_state_/, /^mapi_cookie_consent$/, /^mapi_pos$/, /^mapi_/];

/**
 * Keep only the pairs this store understands, and only when well-formed.
 *
 * An empty object is a legitimate patch: the browser mirroring a jar that has
 * become empty is how the player's own `delCookie` reaches the host, and with
 * `replace` that clears the stored copy. Only a patch with no *recognisable*
 * key is refused, which is what keeps a stray request body from wiping the jar.
 *
 * @param {unknown} patch caller-supplied cookies.
 * @returns {object|null} storable cookies, or `null` when nothing usable came in.
 */
export function sanitize(patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const entries = Object.entries(patch);
  if (entries.length === 0) return { __savedAt: new Date().toISOString() };

  const accepted = [];
  for (const [name, value] of entries) {
    if (value === null) {
      accepted.push([name, null]);
      continue;
    }
    if (storable(name, value)) accepted.push([name, value]);
  }
  if (accepted.length === 0) return null;

  /* Over the cap, drop by rank rather than by insertion order: `Object.keys`
     follows the order the player happened to write, so truncating blindly would
     just as happily throw away the state cookie as a greeting flag. */
  let kept = accepted;
  if (accepted.length > MAX_COOKIES) {
    const rank = (name) => {
      for (let i = 0; i < PRIORITY.length; i += 1) if (PRIORITY[i].test(name)) return i;
      return PRIORITY.length;
    };
    kept = accepted
      .map(([name, value], index) => ({ name, value, index, rank: rank(name) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .slice(0, MAX_COOKIES);
  }

  const next = {};
  for (const item of kept) {
    const name = Array.isArray(item) ? item[0] : item.name;
    const value = Array.isArray(item) ? item[1] : item.value;
    next[name] = value;
  }
  next.__savedAt = new Date().toISOString();
  return next;
}

/**
 * The stored jar, always an object.
 *
 * @param {object} config the stored configuration.
 * @returns {{cookies: object, savedAt: string}} the jar and when it was last written.
 */
export function view(config) {
  const stored =
    config && config.playerState !== null && typeof config.playerState === 'object' ? config.playerState : {};
  const cookies = {};
  for (const [name, value] of Object.entries(stored)) {
    if (name === '__savedAt') continue;
    if (typeof value === 'string' && NAME_PATTERN.test(name)) cookies[name] = value;
  }
  return {
    cookies,
    savedAt: typeof stored.__savedAt === 'string' ? stored.__savedAt : '',
  };
}

/**
 * Merge a patch into the stored jar.
 *
 * A `null` value deletes the cookie, so the player's own `delCookie` (used when
 * it migrates its legacy `mapi_mode` / `mapi_volume` / `mapi_song`) is honoured.
 *
 * @param {object|null} current the stored jar.
 * @param {unknown} patch the cookies to apply.
 * @param {object} [options] merge behaviour.
 * @param {boolean} [options.replace] treat the patch as the whole jar, so a
 *   cookie missing from it is removed. The browser sends its complete jar, and
 *   without this a cookie the player deleted would live on in `config.json` and
 *   come back on the next boot.
 * @returns {object|null} the next jar, or `null` when the patch was unusable.
 */
export function merge(current, patch, options = {}) {
  const clean = sanitize(patch);
  if (clean === null) return null;
  const base = current !== null && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const next = {};
  if (options.replace !== true) {
    for (const [name, value] of Object.entries(base)) {
      if (name === '__savedAt') continue;
      if (typeof value === 'string') next[name] = value;
    }
  }
  for (const [name, value] of Object.entries(clean)) {
    if (name === '__savedAt') continue;
    if (value === null) delete next[name];
    else next[name] = value;
  }
  next.__savedAt = clean.__savedAt;
  return next;
}
