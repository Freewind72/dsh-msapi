/**
 * dsh-msapi — one probe against a Msapi gateway.
 *
 * `action=manifest` is the cheapest call that answers three questions at once:
 * is the gateway where we think it is, is the key accepted, and is there
 * anything to play. It accepts a bare key (no JWT handshake), sits in Msapi's
 * 120/minute bucket, and returns under 200 bytes.
 *
 * `verify-key` is deliberately NOT used: it is rate limited to five calls per
 * minute per IP (`admin/api/api.php` → `rate_limit_check('verifykey', 5, 60)`),
 * so two presses of a Test button would lock the user out for a minute, and it
 * hands back a JWT this plugin never needs.
 *
 * @module dsh-msapi/msapi
 */

import { GATEWAY_CANDIDATES, normalizeUrl } from './config.js';

/** How long one candidate may take before the next one is tried. */
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Map a manifest response onto a small, closed set of key states.
 *
 * @param {object} body parsed JSON body.
 * @returns {'ok'|'invalid'|'disabled'|'missing'|'unknown'} the key state.
 */
function keyStateOf(body) {
  if (body.ok === true) return 'ok';
  const code = typeof body.code === 'string' ? body.code : '';
  if (code === 'invalid_key') return 'invalid';
  if (code === 'key_disabled') return 'disabled';
  if (code === 'missing_key') return 'missing';
  if (code === 'user_missing') return 'invalid';
  return 'unknown';
}

/**
 * Probe a Msapi site.
 *
 * Tries the previously discovered gateway path first, then the two standard
 * ones. A candidate counts as found only when the reply is JSON with at least
 * one recognisable field — a 404 page is HTML, so it falls through instead of
 * being mistaken for an answer.
 *
 * @param {object} options probe inputs.
 * @param {string} options.url the site URL as typed by the user.
 * @param {string} options.key the API key to test (may be empty).
 * @param {string} [options.gatewayPath] a gateway path discovered earlier.
 * @returns {Promise<object>} a probe result; never rejects.
 */
export async function probe({ url, key, gatewayPath = '' }) {
  const started = Date.now();
  let root;
  try {
    root = normalizeUrl(url).root;
  } catch (error) {
    return {
      reachable: false,
      gatewayPath: '',
      keyState: 'unreachable',
      playlists: 0,
      songs: 0,
      version: '',
      latencyMs: 0,
      message: String((error && error.message) || error),
    };
  }

  const trimmedKey = typeof key === 'string' ? key.trim() : '';
  const candidates = [];
  for (const path of [gatewayPath, ...GATEWAY_CANDIDATES]) {
    if (typeof path !== 'string' || path === '') continue;
    if (!candidates.includes(path)) candidates.push(path);
  }

  let lastMessage = '';
  for (const path of candidates) {
    const target =
      `${root}${path}?action=manifest&key=${encodeURIComponent(trimmedKey)}`;
    let response;
    try {
      response = await fetch(target, {
        headers: { accept: 'application/json' },
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // Remember why the *first* candidate failed: it is the one a user with a
      // normal deployment is actually running, so naming the last fallback
      // would point at a path they never used.
      if (lastMessage === '') lastMessage = String((error && error.message) || error);
      continue;
    }
    let body;
    try {
      const text = await response.text();
      body = JSON.parse(text);
    } catch {
      lastMessage = `${path}: HTTP ${response.status}, not JSON`;
      continue;
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      lastMessage = `${path}: unexpected JSON shape`;
      continue;
    }
    const keyState = keyStateOf(body);
    if (keyState === 'unknown' && body.ok === undefined && body.code === undefined) {
      lastMessage = `${path}: unrecognised reply`;
      continue;
    }
    return {
      reachable: true,
      gatewayPath: path,
      keyState,
      playlists: Number(body.pl) || 0,
      songs: Number(body.sg) || 0,
      version: typeof body.v === 'string' ? body.v : '',
      latencyMs: Date.now() - started,
      message: typeof body.msg === 'string' ? body.msg : '',
      probedAt: new Date().toISOString(),
    };
  }

  return {
    reachable: false,
    gatewayPath: '',
    keyState: 'unreachable',
    playlists: 0,
    songs: 0,
    version: '',
    latencyMs: Date.now() - started,
    message: lastMessage === '' ? 'no gateway answered' : lastMessage,
    probedAt: new Date().toISOString(),
  };
}
