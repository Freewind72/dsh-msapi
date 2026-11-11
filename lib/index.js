/**
 * dsh-msapi — host half.
 *
 * Five same-origin routes, one JSON file, no network access at boot:
 *
 *   GET  /dsh-msapi/settings      the browser-safe configuration view
 *   PUT  /dsh-msapi/settings      merge url / key / enabled, then probe once
 *   POST /dsh-msapi/probe         probe the current (or supplied) values, no write
 *   GET  /dsh-msapi/player        the embed URL the page should inject
 *   PUT  /dsh-msapi/player        switch the player on or off
 *   GET  /dsh-msapi/state         the emulated cookie jar (see player-state.js)
 *   PUT  /dsh-msapi/state         merge the jar the page mirror sent
 *   GET  /dsh-msapi/diagnostics   the page's own account, for bug reports
 *   PUT  /dsh-msapi/diagnostics   accept one report
 *
 * The key never travels to the browser through `/settings`. It does appear in
 * the embed URL handed out by `/player`, because a Msapi embed carries its key
 * in the script's own query string — that is the embedding contract, and the
 * README states it plainly.
 *
 * Mutations require the GUI's signed session cookie, the same gate
 * `dsh-windows-mcp` uses: a script, or a model with shell access, must not be
 * able to point the player at a site of its choosing.
 *
 * @module dsh-msapi
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { readConfig, publicView, stateDirectory, writeConfig } from './config.js';
import { probe } from './msapi.js';
import { merge as mergePlayerState, view as playerStateView } from './player-state.js';

/** Cordis plugin name. */
export const name = 'dsh-msapi';

/** Services that must exist before this plugin does anything. */
export const inject = ['webServer'];

/** Route paths, kept together so the browser half can mirror them verbatim. */
export const ROUTES = {
  settings: '/dsh-msapi/settings',
  probe: '/dsh-msapi/probe',
  player: '/dsh-msapi/player',
  state: '/dsh-msapi/state',
  diagnostics: '/dsh-msapi/diagnostics',
};

/** Largest request body accepted, in bytes. */
const MAX_BODY_BYTES = 64 * 1024;

/** Identifier the injected script uses, so the page can find its own instance. */
export const PLAYER_INSTANCE_ID = 'dsh-msapi';

/**
 * Build the embed URL for a configured site and key.
 *
 * The `api` parameter is deliberately absent: `api.php` already injects the
 * real admin directory into the bootstrap, so a renamed admin folder needs no
 * help from us. `data-player-id` pins the player's dedup key, which is what
 * lets a reload find and replace its own instance instead of stacking a second
 * one.
 *
 * @param {string} root normalized site root.
 * @param {string} key the API key.
 * @returns {string} a script URL.
 */
export function embedUrl(root, key) {
  const query = new URLSearchParams({
    key,
    'data-player-id': PLAYER_INSTANCE_ID,
    v: '4',
  });
  return `${root}/api.php?${query.toString()}`;
}

/**
 * Write one JSON response.
 *
 * @param {object} response the HTTP response.
 * @param {number} status HTTP status.
 * @param {object} payload JSON-serializable body.
 */
function respond(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

/**
 * Read and parse a bounded JSON request body.
 *
 * @param {object} request the HTTP request.
 * @returns {Promise<object>} the parsed body, `{}` when empty.
 * @throws {Error} on an oversized or malformed body.
 */
function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(badRequest('request body is too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text === '') {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(text);
        resolve(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
      } catch {
        reject(badRequest('invalid JSON body'));
      }
    });
    request.on('error', fail);
  });
}

/**
 * Build an error the route layer answers with a 400.
 *
 * @param {string} message the message shown to the caller.
 * @returns {Error} a `BAD_REQUEST`-coded error.
 */
function badRequest(message) {
  const error = new Error(message);
  error.code = 'BAD_REQUEST';
  return error;
}

/**
 * Whether the request carries the GUI's signed session cookie.
 *
 * @param {object} ctx plugin context.
 * @param {object} request the HTTP request.
 * @returns {boolean|null} true/false when observable, `null` when this host has
 *   no browser-auth seam (then the caller must not refuse anything).
 */
function browserSession(ctx, request) {
  let connection = null;
  try {
    if (typeof ctx.get === 'function') connection = ctx.get('connection') ?? null;
  } catch {
    connection = null;
  }
  const auth = connection === null || connection === undefined ? null : connection.browserAuth;
  if (auth === null || auth === undefined || typeof auth.isAuthenticated !== 'function') return null;
  let secure = false;
  try {
    secure = ctx.webServer?.protocol === 'https:';
  } catch {
    secure = false;
  }
  try {
    return auth.isAuthenticated(request, secure) === true;
  } catch {
    return false;
  }
}

/**
 * Wrap a handler so a thrown error becomes a JSON 500 instead of a hung socket.
 *
 * @param {Function} handler the inner handler.
 * @returns {Function} the guarded handler.
 */
/**
 * Wrap a handler so a thrown error becomes a JSON 500 instead of a hung socket.
 *
 * @param {Function} handler the inner handler.
 * @param {Function|null} [warn] sink for the details; the caller supplies it
 *   because the message must not travel back to the page.
 * @returns {Function} the guarded handler.
 */
function safeHandler(handler, warn = null) {
  return async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      const status = error && error.code === 'BAD_REQUEST' ? 400 : error && error.code === 'ENOENT' ? 404 : 500;
      /* Only a deliberate 400 carries its message onward; an unexpected 500 can
         hold a filesystem path or a stack fragment, and this route is reachable
         from the page. */
      const message = status === 400 ? String((error && error.message) || error) : 'internal error';
      if (status !== 400 && typeof warn === 'function') {
        try {
          warn(String((error && error.stack) || error));
        } catch {
          /* a broken sink must not change the answer */
        }
      }
      try {
        respond(response, status, { ok: false, error: message });
      } catch {
        /* the socket is already gone */
      }
    }
  };
}

/**
 * The request's method, upper-cased.
 *
 * @param {object} request the HTTP request.
 * @returns {string} a method name such as `GET`.
 */
function methodOf(request) {
  return String(request.method || 'GET').toUpperCase();
}

/**
 * Answer a method the route does not serve.
 *
 * @param {object} response the HTTP response.
 */
function methodNotAllowed(response) {
  respond(response, 405, { ok: false, error: 'method not allowed' });
}

/**
 * Refuse a mutation that did not come from the GUI window.
 *
 * @param {object} ctx plugin context.
 * @param {Function} handler the inner handler.
 * @returns {Function} the guarded handler.
 */
function guarded(ctx, handler) {
  return async (request, response) => {
    const method = methodOf(request);
    if (method !== 'GET' && method !== 'HEAD') {
      if (browserSession(ctx, request) === false) {
        respond(response, 401, {
          ok: false,
          error: 'this change has to come from the DSH window',
          hint: 'the request carried no signed session cookie; use the Settings page',
        });
        return;
      }
    }
    await handler(request, response);
  };
}

/**
 * GET/PUT the settings.
 *
 * A PUT always answers with the view *and* one probe, so "Save" gives a
 * deterministic answer instead of leaving the user to press Test afterwards.
 * Probe failures never fail the save: `ok` reports the write, `probe` reports
 * the connection, and conflating them would make a wrong key look like a
 * storage error.
 *
 * @param {string} directory state directory.
 * @param {object} request the HTTP request.
 * @param {object} response the HTTP response.
 */
async function handleSettings(directory, request, response) {
  const method = methodOf(request);
  if (method === 'GET' || method === 'HEAD') {
    const config = await readConfig(directory);
    respond(response, 200, { ok: true, view: publicView(config) });
    return;
  }
  if (method !== 'PUT') {
    methodNotAllowed(response);
    return;
  }

  const body = await readJson(request);
  const patch = {};
  if (Object.hasOwn(body, 'url')) patch.url = typeof body.url === 'string' ? body.url.trim() : '';
  if (typeof body.key === 'string' && body.key.trim() !== '') patch.key = body.key.trim();
  if (body.clearKey === true) patch.key = '';
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;

  const mustProbe = Object.hasOwn(patch, 'url') || Object.hasOwn(patch, 'key');
  const written = await writeConfig(directory, patch);

  let result = null;
  if (mustProbe) {
    result = await probe({ url: written.url, key: written.key, gatewayPath: written.gatewayPath });
    const followUp = { lastProbe: result };
    if (result.reachable && result.gatewayPath !== '') followUp.gatewayPath = result.gatewayPath;
    await writeConfig(directory, followUp);
  }

  const config = await readConfig(directory);
  respond(response, 200, { ok: true, view: publicView(config), probe: result });
}

/**
 * POST a probe without touching the stored configuration.
 *
 * @param {string} directory state directory.
 * @param {object} request the HTTP request.
 * @param {object} response the HTTP response.
 */
async function handleProbe(directory, request, response) {
  const method = methodOf(request);
  if (method !== 'POST') {
    methodNotAllowed(response);
    return;
  }
  const body = await readJson(request);
  const config = await readConfig(directory);
  const url = Object.hasOwn(body, 'url') && typeof body.url === 'string' ? body.url : config.url;
  const key = Object.hasOwn(body, 'key') && typeof body.key === 'string' && body.key.trim() !== ''
    ? body.key.trim()
    : config.key;
  const result = await probe({ url, key, gatewayPath: config.gatewayPath });
  respond(response, 200, { ok: true, probe: result });
}

/**
 * GET the embed URL, or PUT the on/off switch.
 *
 * @param {string} directory state directory.
 * @param {object} request the HTTP request.
 * @param {object} response the HTTP response.
 */
async function handlePlayer(directory, request, response) {
  const method = methodOf(request);
  if (method === 'PUT') {
    const body = await readJson(request);
    if (typeof body.enabled === 'boolean') await writeConfig(directory, { enabled: body.enabled });
  } else if (method !== 'GET' && method !== 'HEAD') {
    methodNotAllowed(response);
    return;
  }

  const config = await readConfig(directory);
  const view = publicView(config);
  const ready = view.enabled && view.keyConfigured && view.urlError === '';
  respond(response, 200, {
    ok: true,
    enabled: ready,
    src: ready ? embedUrl(view.urlEffective, config.key) : '',
    view,
  });
}

/**
 * GET the player's durable memory, or PUT a change to it.
 *
 * This exists because the player's own cookie cannot survive a DSH restart: the
 * Web GUI picks a new port each launch, and both cookies and `localStorage` are
 * scoped to an origin that includes it. See `lib/player-state.js`.
 *
 * @param {string} directory state directory.
 * @param {object} request the HTTP request.
 * @param {object} response the HTTP response.
 */
async function handleState(directory, request, response) {
  const method = methodOf(request);
  if (method === 'GET' || method === 'HEAD') {
    const config = await readConfig(directory);
    respond(response, 200, { ok: true, state: playerStateView(config) });
    return;
  }
  if (method !== 'PUT') {
    methodNotAllowed(response);
    return;
  }
  const body = await readJson(request);
  const config = await readConfig(directory);
  const patch = body.cookies !== null && typeof body.cookies === 'object' ? body.cookies : null;
  if (patch === null) {
    respond(response, 400, { ok: false, error: 'expected a cookies object' });
    return;
  }
  /* The browser sends its whole jar, so a cookie missing from it was deleted by
     the player and has to disappear here too — a merge would keep it alive and
     hand it back on the next boot. */
  const next = mergePlayerState(config.playerState, patch, { replace: true });
  if (next === null) {
    respond(response, 400, { ok: false, error: 'nothing storable in the body' });
    return;
  }
  await writeConfig(directory, { playerState: next });
  respond(response, 200, { ok: true, state: playerStateView(await readConfig(directory)) });
}

/**
 * GET the browser half's own diagnostics.
 *
 * The Settings page reports what it observed — whether the bundle's `apply` ran,
 * how many embed scripts it injected, which cookies the jar holds — into a file
 * next to the config. When the browser and the host disagree about what
 * happened, this is the only account that is not a guess.
 *
 * @param {string} directory state directory.
 * @param {object} request the HTTP request.
 * @param {object} response the HTTP response.
 */
async function handleDiagnostics(directory, request, response) {
  const method = methodOf(request);
  if (method === 'GET' || method === 'HEAD') {
    let report = null;
    try {
      report = JSON.parse(await readFile(join(directory, 'diagnostics.json'), 'utf8'));
    } catch {
      report = null;
    }
    respond(response, 200, { ok: true, report });
    return;
  }
  if (method !== 'PUT') {
    methodNotAllowed(response);
    return;
  }
  const body = await readJson(request);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
      join(directory, 'diagnostics.json'),
      `${JSON.stringify({ ...body, receivedAt: new Date().toISOString() }, null, 2)}\n`,
      'utf8',
    );
  } catch {
    /* diagnostics must never break the caller */
  }
  respond(response, 200, { ok: true });
}

/**
 * Plugin entry point. Never throws.
 *
 * @param {object} ctx host cordis context.
 */
export function apply(ctx) {
  const directory = stateDirectory();
  /* Resolved once: a missing logger is normal, and every route needs the same
     decision about where an unexpected error's detail goes. */
  let warn = null;
  try {
    const logger = typeof ctx.logger === 'function' ? ctx.logger('dsh-msapi') : null;
    if (logger && typeof logger.warn === 'function') warn = (text) => logger.warn(text);
  } catch {
    warn = null;
  }
  try {
    const register = (path, handler) => {
      ctx.webServer.register({
        kind: 'exact',
        path,
        handler: guarded(ctx, safeHandler(handler, warn)),
      });
    };
    register(ROUTES.settings, (request, response) => handleSettings(directory, request, response));
    register(ROUTES.probe, (request, response) => handleProbe(directory, request, response));
    register(ROUTES.player, (request, response) => handlePlayer(directory, request, response));
    register(ROUTES.state, (request, response) => handleState(directory, request, response));
    register(ROUTES.diagnostics, (request, response) => handleDiagnostics(directory, request, response));
  } catch (error) {
    if (typeof warn === 'function') warn(`could not register the Msapi routes: ${String(error)}`);
  }
}

/**
 * Re-exports for tests and for the local harness that mounts the routes by hand.
 *
 * Only what is actually read from outside is here: the route handlers stay
 * private, because exposing them would imply a contract nobody depends on.
 */
export const __internals = { embedUrl, stateDirectory };

