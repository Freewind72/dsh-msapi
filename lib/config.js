/**
 * dsh-msapi — configuration store.
 *
 * One JSON file under the DSH home owns the whole surface: the site URL the
 * user typed (possibly empty), the API key, the gateway path the last probe
 * discovered, whether the player is switched on, and the last probe result so
 * the Settings page can show a status line before it has tested anything.
 *
 * Why a file instead of the DSH `settings` service: that service writes
 * volatile fields into the profile's `cordis.patch.yml`, a document DSH treats
 * as shareable. A secret must not land there. Why a file instead of
 * `localStorage`: the Web GUI's port is not guaranteed stable, and
 * `localStorage` is origin-scoped, so a new port silently loses the settings.
 *
 * @module dsh-msapi/config
 */

import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Official site, used whenever the URL field is left empty. */
export const DEFAULT_ROOT = 'https://msapi.bmwy72.top';

/** Gateway paths tried, in order, when probing a site. */
export const GATEWAY_CANDIDATES = ['/admin/api/api.php', '/api/api.php'];

/** Bumped only when the on-disk shape changes incompatibly. */
export const CONFIG_VERSION = 1;

/** Fields `writeConfig` accepts from a caller. */
const PATCHABLE = new Set(['url', 'key', 'gatewayPath', 'enabled', 'lastProbe', 'playerState']);

/**
 * Directory holding this plugin's state.
 *
 * @param {string} [home] DSH home override; defaults to `$DSH_HOME` or `~/.dsh`.
 * @returns {string} absolute directory path.
 */
export function stateDirectory(home = process.env.DSH_HOME || join(homedir(), '.dsh')) {
  return join(home, 'dsh-msapi');
}

/**
 * @param {string} directory state directory.
 * @returns {string} absolute config file path.
 */
export function configPath(directory) {
  return join(directory, 'config.json');
}

/**
 * A fresh, fully populated configuration.
 *
 * @returns {object} the default configuration.
 */
export function defaults() {
  return {
    schemaVersion: CONFIG_VERSION,
    /** Raw user input; an empty string means "use DEFAULT_ROOT". */
    url: '',
    key: '',
    /** Gateway path that last answered; empty means "not discovered yet". */
    gatewayPath: '',
    /** Whether the player is mounted on the DSH page. */
    enabled: true,
    updatedAt: '',
    /** Last probe result, kept only so the page can render a status line. */
    lastProbe: null,
    /**
     * The emulated cookie jar the player writes through, kept here because
     * `document.cookie` does nothing on the `dsh-app://` scheme the desktop shell
     * serves the UI from. See `lib/player-state.js`.
     */
    playerState: null,
  };
}

/**
 * Short, non-reversible identifier for a key, safe to send to the browser.
 *
 * @param {string} key the stored key (may be empty).
 * @returns {string} eight hex characters, or `''` when no key is stored.
 */
export function fingerprint(key) {
  const value = typeof key === 'string' ? key : '';
  if (value === '') return '';
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8);
}

/**
 * Hosts that make a URL unfit for an unattended server-side probe.
 *
 * `probe()` fetches whatever URL the settings hold, from the host process, which
 * sits behind no proxy. That is an SSRF primitive: a request body can point it at
 * a cloud metadata endpoint or any service on the loopback network and read the
 * status back through `latencyMs` and `message`.
 *
 * Loopback is deliberately *allowed* — a self-hosted Msapi on
 * `http://127.0.0.1:8080` is a supported setup — so the guard targets the two
 * ranges that have no legitimate use here: link-local (metadata services) and
 * the unspecified address.
 *
 * @param {URL} parsed a parsed, http(s) URL.
 * @returns {boolean} whether the host is off limits.
 */
function isForbiddenHost(parsed) {
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === '' || host === '0.0.0.0' || host === '::') return true;
  /* IPv4 link-local: cloud metadata lives at 169.254.169.254. */
  if (/^169\.254\./.test(host)) return true;
  /* IPv6 link-local and unique-local. */
  if (/^fe80:/i.test(host)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  return false;
}

/**
 * Normalize whatever the user pasted into a bare site root.
 *
 * The input means "the site", not "an endpoint": Msapi exposes two unrelated
 * paths (`/api.php` for the embed script and `/<adminDir>/api/api.php` for the
 * JSON gateway) and the admin directory can be renamed, so a full endpoint URL
 * is trimmed back to its root and its gateway path is remembered as a hint.
 *
 * @param {unknown} input raw field value.
 * @returns {{ root: string, hintedGatewayPath: string, source: 'default'|'input' }}
 * @throws {Error} with `code` `INVALID_URL`, `UNSUPPORTED_SCHEME`, `NON_ASCII_URL`
 *   or `FORBIDDEN_HOST`.
 */
export function normalizeUrl(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (raw === '') return { root: DEFAULT_ROOT, hintedGatewayPath: '', source: 'default' };
  if (/[^\x20-\x7E]/.test(raw)) {
    throw withCode(new Error('the URL contains non-ASCII characters'), 'NON_ASCII_URL');
  }
  // Wrapping whitespace is a paste artefact and is dropped; a space *inside* the
  // value is a typo, and silently gluing it into a different host would be worse
  // than refusing it.
  const compact = raw.replace(/[\r\n\t]/g, '').trim();
  if (/\s/.test(compact)) {
    throw withCode(new Error('the URL contains a space'), 'INVALID_URL');
  }
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(compact) ? compact : `https://${compact}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw withCode(new Error(`cannot parse "${raw}" as a URL`), 'INVALID_URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw withCode(new Error(`unsupported scheme "${parsed.protocol}"`), 'UNSUPPORTED_SCHEME');
  }
  if (parsed.hostname === '') {
    throw withCode(new Error(`"${raw}" has no host`), 'INVALID_URL');
  }
  if (isForbiddenHost(parsed)) {
    throw withCode(new Error(`"${parsed.hostname}" is not a public host`), 'FORBIDDEN_HOST');
  }

  let path = parsed.pathname.replace(/\/+$/, '');
  let hintedGatewayPath = '';
  const gateway = /^(.*)\/([^/]+)\/api\/api\.php$/i.exec(path);
  if (gateway !== null) {
    hintedGatewayPath = `/${gateway[2]}/api/api.php`;
    path = gateway[1];
  } else if (/\/api\.php$/i.test(path)) {
    path = path.replace(/\/api\.php$/i, '');
  }
  const root = parsed.origin + (path === '' || path === '/' ? '' : path);
  return { root, hintedGatewayPath, source: 'input' };
}

/**
 * Normalize without throwing; used by the read path, where a bad stored value
 * must degrade to the default instead of breaking every request.
 *
 * @param {unknown} input raw field value.
 * @returns {{ root: string, hintedGatewayPath: string, source: string, error: string }}
 */
export function tryNormalizeUrl(input) {
  try {
    return { ...normalizeUrl(input), error: '' };
  } catch (error) {
    return {
      root: DEFAULT_ROOT,
      hintedGatewayPath: '',
      source: 'fallback',
      error: String((error && error.message) || error),
    };
  }
}

/**
 * Read the configuration, self-healing a damaged file.
 *
 * A parse failure renames the file to `config.json.corrupt-<timestamp>` and
 * returns defaults: a half-written file must never wedge the plugin, and the
 * user's key has to stay recoverable by hand.
 *
 * @param {string} directory state directory.
 * @returns {Promise<object>} the configuration, always fully populated.
 */
export async function readConfig(directory) {
  const file = configPath(directory);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return defaults();
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/u, ''));
  } catch {
    try {
      await rename(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      /* nothing else to do: defaults are still correct */
    }
    return defaults();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults();
  const base = defaults();
  return {
    ...base,
    url: typeof parsed.url === 'string' ? parsed.url : base.url,
    key: typeof parsed.key === 'string' ? parsed.key : base.key,
    gatewayPath: typeof parsed.gatewayPath === 'string' ? parsed.gatewayPath : base.gatewayPath,
    enabled: parsed.enabled !== false,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    lastProbe: parsed.lastProbe !== null && typeof parsed.lastProbe === 'object' ? parsed.lastProbe : null,
    playerState:
      parsed.playerState !== null && typeof parsed.playerState === 'object' && !Array.isArray(parsed.playerState)
        ? parsed.playerState
        : null,
  };
}

/**
 * Merge a patch into the configuration and persist it atomically.
 *
 * The write goes to `config.json.tmp` and is renamed into place, so a crash
 * mid-write leaves the previous file intact rather than a truncated one. The
 * mode is 0600 because the file holds a secret.
 *
 * @param {string} directory state directory.
 * @param {object} patch fields to merge; unknown fields are ignored.
 * @returns {Promise<object>} the configuration as written.
 */
export async function writeConfig(directory, patch) {
  const current = await readConfig(directory);
  const next = { ...current, schemaVersion: CONFIG_VERSION };
  const source = patch !== null && typeof patch === 'object' ? patch : {};
  for (const [key, value] of Object.entries(source)) {
    if (!PATCHABLE.has(key)) continue;
    next[key] = value;
  }
  next.updatedAt = new Date().toISOString();

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = configPath(directory);
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, file);
  try {
    await chmod(file, 0o600);
  } catch {
    /* Windows has no meaningful POSIX mode; the rename already succeeded. */
  }
  return next;
}

/**
 * The configuration as the browser is allowed to see it.
 *
 * The key itself never crosses this boundary: only whether one is stored, how
 * long it is, and a fingerprint the user can match against their records.
 *
 * @param {object} config the stored configuration.
 * @returns {object} a browser-safe view.
 */
export function publicView(config) {
  const effective = tryNormalizeUrl(config.url);
  const key = typeof config.key === 'string' ? config.key : '';
  return {
    url: typeof config.url === 'string' ? config.url : '',
    urlEffective: effective.root,
    urlError: effective.error,
    keyConfigured: key !== '',
    keyFingerprint: fingerprint(key),
    keyLength: key.length,
    gatewayPath: typeof config.gatewayPath === 'string' ? config.gatewayPath : '',
    enabled: config.enabled !== false,
    updatedAt: typeof config.updatedAt === 'string' ? config.updatedAt : '',
    lastProbe: config.lastProbe !== null && typeof config.lastProbe === 'object' ? config.lastProbe : null,
    defaults: { root: DEFAULT_ROOT },
  };
}

/**
 * Attach a machine-readable `code` to an error.
 *
 * @param {Error} error the error to annotate.
 * @param {string} code the code to attach.
 * @returns {Error} the same error.
 */
function withCode(error, code) {
  error.code = code;
  return error;
}
