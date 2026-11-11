window.__ModuleLoader__.load({
	id: "dsh-msapi",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var React = require("react");

		var PACKAGE_ID = "dsh-msapi";
		var SETTINGS_SLOT = "settings.section";
		var ENTRY_ID = "msapi-player";
		var ENTRY_ORDER = 540;
		var VIEWPORT_ID = "dsh-msapi-viewport";
		var GRIP_ID = "dsh-msapi-grip";
		var STYLE_ID = "dsh-msapi-styles";
		var SCRIPT_ATTR = "data-dsh-msapi";
		/** Marks the style element this plugin appends inside a player's shadow tree. */
		var SHADOW_STYLE_ATTR = "data-dsh-msapi-immersive";
		/** Marks a lyric strip whose box model has been pinned. */
		var LRC_PATCHED_ATTR = "data-dsh-msapi-lrc";
		var DEDUP_KEY = "id:dsh-msapi";
		var SETTINGS_PATH = "/dsh-msapi/settings";
		var PROBE_PATH = "/dsh-msapi/probe";
		var PLAYER_PATH = "/dsh-msapi/player";
		var STATE_PATH = "/dsh-msapi/state";
		var DIAGNOSTICS_PATH = "/dsh-msapi/diagnostics";

		/** Minimum gap between the player's dock and the window's bottom edge. */
		var COMPOSER_CLEARANCE_PX = 96;

		/** Only `slots` is injected: it is certainly provided, and declaring a
		 *  service nobody provides would leave this plugin's fiber pending. */
		var inject = ["slots"];

		var h = function (tag, props) {
			var children = Array.prototype.slice.call(arguments, 2);
			return React.createElement.apply(React, [tag, props].concat(children));
		};

		/* ------------------------------------------------------------------ *
		 * copy
		 * ------------------------------------------------------------------ */

		var ZH = {
			navLabel: "音乐播放器",
			title: "音乐播放器",
			intro: "填好服务地址和接口密钥，Msapi 播放器会直接嵌入当前窗口。",
			urlLabel: "服务地址",
			urlPlaceholder: "https://msapi.bmwy72.top",
			urlHint: function (root) {
				return "留空使用官方地址 " + root;
			},
			keyLabel: "接口密钥",
			keyPlaceholder: "粘贴 Msapi 后台「密钥」页里的 key",
			keyHintEmpty: "尚未配置密钥，播放器不会挂载。",
			keyHintSaved: function (view) {
				return "已保存 · 指纹 " + view.keyFingerprint + " · " + view.keyLength + " 位";
			},
			keyHintTyping: "留空表示沿用已保存的密钥。",
			save: "保存",
			saving: "保存中…",
			test: "测试连接",
			testing: "测试中…",
			clearKey: "清除密钥",
			enablePlayer: "开启播放器",
			disablePlayer: "关闭播放器",
			playerOn: "播放器已开启",
			playerOff: "播放器已关闭",
			playerNeedsKey: "播放器已开启，但还没配置密钥。",
			notTested: "尚未测试",
			probeOk: function (probe) {
				return "连接正常 · 歌单 " + probe.playlists + " · 歌曲 " + probe.songs + " · " + probe.latencyMs + "ms";
			},
			probeNoPlaylist: function (probe) {
				return "连接正常 · 后台还没有歌单 · " + probe.latencyMs + "ms";
			},
			unreachable: "连不上服务器",
			invalidKey: "密钥无效",
			keyDisabled: "密钥已被停用",
			missingKey: "网关没收到密钥",
			unknownState: "服务器返回了异常响应",
			saveFailed: "保存失败",
			saved: "已保存",
			loadFailed: "读不到插件设置（宿主路由没有响应）",
			loading: "读取中…",
		};

		var EN = {
			navLabel: "Music Player",
			title: "Music Player",
			intro: "Set the site URL and an API key; the Msapi player is embedded straight into this window.",
			urlLabel: "Site URL",
			urlPlaceholder: "https://msapi.bmwy72.top",
			urlHint: function (root) {
				return "Leave empty to use the official site " + root;
			},
			keyLabel: "API key",
			keyPlaceholder: "Paste the key from the Msapi admin Keys page",
			keyHintEmpty: "No key stored yet; the player stays off.",
			keyHintSaved: function (view) {
				return "Stored · fingerprint " + view.keyFingerprint + " · " + view.keyLength + " chars";
			},
			keyHintTyping: "Leave empty to keep the stored key.",
			save: "Save",
			saving: "Saving…",
			test: "Test connection",
			testing: "Testing…",
			clearKey: "Remove key",
			enablePlayer: "Turn player on",
			disablePlayer: "Turn player off",
			playerOn: "Player is on",
			playerOff: "Player is off",
			playerNeedsKey: "The player is on but no key is stored.",
			notTested: "Not tested yet",
			probeOk: function (probe) {
				return "Connected · " + probe.playlists + " playlists · " + probe.songs + " songs · " + probe.latencyMs + "ms";
			},
			probeNoPlaylist: function (probe) {
				return "Connected · no playlists yet · " + probe.latencyMs + "ms";
			},
			unreachable: "Cannot reach the server",
			invalidKey: "The key is not valid",
			keyDisabled: "The key is disabled",
			missingKey: "The gateway received no key",
			unknownState: "The server answered something unexpected",
			saveFailed: "Could not save",
			saved: "Saved",
			loadFailed: "Could not read the plugin settings (the host route did not answer)",
			loading: "Loading…",
		};

		var language = "en";
		try {
			language = String((typeof navigator !== "undefined" && navigator.language) || "").toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
		} catch (error) {
			language = "en";
		}

		function copy() {
			return language === "zh" ? ZH : EN;
		}

		/* ------------------------------------------------------------------ *
		 * styles
		 * ------------------------------------------------------------------ */

		/**
		 * The viewport rules are the load-bearing part.
		 *
		 * `transform` makes this element the containing block for every
		 * `position: fixed` descendant, so the player's own full-screen layer
		 * (`inset: 0`) resolves against this box instead of the window; `isolation`
		 * keeps its `z-index: 2147483647` from climbing over DSH's dialogs.
		 *
		 * The top clearance is written here as a variable but *computed in
		 * JavaScript* (`applyViewportClearance`). It used to be derived purely in
		 * CSS from `html[data-windows-titlebar]`; that put the whole rule behind a
		 * selector match, and when it failed to apply the player sat straight under
		 * the native caption buttons. Reading the value and setting it inline
		 * removes the selector from the path entirely.
		 *
		 * `clip-path` and not a top inset: an inset would only change where the box
		 * starts, while a dragged player writes absolute coordinates and would
		 * still paint over the caption bar. Clipping removes that strip from both
		 * painting and hit-testing, and — unlike a positional inset — leaves every
		 * child coordinate identical, so the player's own drag maths stays correct.
		 *
		 * The same variable feeds the toast layer: the player pins its notices to
		 * `top: 16px`, which is inside the very strip the clip removes, so shifting
		 * them down is the only thing that keeps an error message visible.
		 */
		var CSS = [
			"#" + VIEWPORT_ID + "{--dms-top-clear:0px;position:fixed;inset:0;z-index:900;pointer-events:none;transform:translateZ(0);isolation:isolate;clip-path:inset(var(--dms-top-clear) 0 0 0)}",
			"#" + VIEWPORT_ID + ">#mapi-notices{top:calc(var(--dms-top-clear) + 16px)!important}",
			"#" + GRIP_ID + "{position:fixed;height:10px;border-radius:0 0 6px 6px;background:transparent;pointer-events:auto;cursor:grab;touch-action:none;z-index:2147483647;transition:background .15s}",
			"#" + GRIP_ID + ":hover,#" + GRIP_ID + "[data-dragging]{background:var(--dsw-alias-state-business-primary,#4d7cfe);opacity:.75}",
			".dms-page{display:flex;flex-direction:column;gap:16px;padding:2px 2px 10px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#e6e6e6)}",
			".dms-intro{margin:0;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:12px}",
			".dms-card{display:flex;flex-direction:column;gap:16px;padding:16px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.03))}",
			".dms-field{display:flex;flex-direction:column;gap:6px}",
			".dms-field__label{font-size:13px;color:var(--dsw-alias-label-secondary,#b8b8b8)}",
			".dms-input{height:32px;padding:0 10px;border-radius:var(--dsw-radius-sm,6px);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:var(--dsw-alias-bg-base,#151515);color:inherit;font:inherit;outline:none}",
			".dms-input:focus{border-color:var(--dsw-alias-state-business-primary,#4d7cfe);box-shadow:0 0 0 2px rgba(77,124,254,.22)}",
			".dms-input::placeholder{color:var(--dsw-alias-label-tertiary,#8a8a8a)}",
			".dms-hint{font-size:12px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}",
			".dms-hint--error{color:var(--dsw-alias-state-error-primary,#f85149)}",
			".dms-status{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#b8b8b8);min-height:18px}",
			".dms-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary,#8a8a8a)}",
			".dms-dot--ok{background:var(--dsw-alias-state-success-primary,#3fb950)}",
			".dms-dot--warn{background:var(--dsw-alias-state-warn-primary,#d29922)}",
			".dms-dot--error{background:var(--dsw-alias-state-error-primary,#f85149)}",
			".dms-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}",
			".dms-btn{height:30px;padding:0 14px;border-radius:var(--dsw-radius-sm,6px);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:transparent;color:inherit;font:inherit;cursor:pointer}",
			".dms-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}",
			".dms-btn:disabled{opacity:.5;cursor:default}",
			".dms-btn--primary{background:var(--dsw-alias-state-business-primary,#4d7cfe);border-color:transparent;color:#fff}",
			".dms-btn--primary:hover:not(:disabled){filter:brightness(1.08);background:var(--dsw-alias-state-business-primary,#4d7cfe)}",
			".dms-error{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary,#f85149)}",
			".dms-sep{height:1px;background:var(--dsw-alias-border-l1,rgba(255,255,255,.12))}",
		].join("\n");

		/**
		 * Install the stylesheet once. A missing stylesheet only costs polish, so
		 * every failure is swallowed.
		 */
		function installStyles() {
			try {
				if (typeof document === "undefined") return;
				if (document.getElementById(STYLE_ID) !== null) return;
				var style = document.createElement("style");
				style.id = STYLE_ID;
				style.textContent = CSS;
				document.head.appendChild(style);
			} catch (error) {
				/* nothing to do */
			}
		}

		/**
		 * Same-origin URL for a host route, anchored on `document.baseURI` because
		 * the host does not use path routing.
		 *
		 * @param {string} path route path.
		 * @returns {string} a same-origin path.
		 */
		function apiUrl(path) {
			var relative = String(path).replace(/^\/+/, "");
			try {
				if (typeof document === "undefined") return "/" + relative;
				return new URL(relative, document.baseURI).pathname;
			} catch (error) {
				return "/" + relative;
			}
		}

		/** Result of the last attempt to reach the host, for the diagnostics report. */
		var lastResult = { path: "", status: 0, body: "", error: "" };

		/**
		 * Read one JSON route.
		 *
		 * @param {string} path route path.
		 * @param {object} [init] fetch options.
		 * @returns {Promise<object>} the parsed body.
		 */
		function requestJson(path, init) {
			var options = init || {};
			options.headers = Object.assign({ accept: "application/json" }, options.headers || {});
			options.cache = "no-store";
			return fetch(apiUrl(path), options).then(
				function (response) {
					lastResult = { path: path, status: response.status, body: "", error: "" };
					/* Read the body as text so a non-JSON answer (an HTML 404 page, a
					   proxy error) can be reported instead of surfacing as a parse
					   crash. Falls back to `json()` for hosts that only expose that. */
					var read;
					if (typeof response.text === "function") {
						read = response.text().then(function (text) {
							lastResult.body = String(text).slice(0, 300);
							try {
								return JSON.parse(text);
							} catch (error) {
								return { ok: false, error: "not JSON" };
							}
						});
					} else {
						read = response.json();
					}
					return read.then(function (parsed) {
						return { status: response.status, body: parsed };
					});
				},
				function (error) {
					lastResult = {
						path: path,
						status: 0,
						body: "",
						error: String((error && error.message) || error),
					};
					throw error;
				},
			);
		}

		/**
		/**
		 * The jar the player thinks it is writing to.
		 *
		 * DSH Desktop serves the page over a custom `dsh-app://` scheme, and cookies
		 * do not work there at all — assignment is silently ignored and the getter
		 * always returns `""`. A live page reported `href: "dsh-app://app/"` with an
		 * empty jar while the player was running and had already asked for consent.
		 * That, and not the changing port, is why nothing was ever persisted.
		 *
		 * Rather than patch the player's call sites, its own cookie seam is replaced:
		 * `MP._.setCookie` / `getCookie` / `delCookie` are what `core/state.js`,
		 * `core/auth.js` and `core/theme.js` all go through, so redirecting those
		 * three makes every part of the player remember itself. Values stay the
		 * player's own strings — it cannot tell this jar from a real one.
		 */
		var jar = Object.create(null);

		/**
		 * Names the diagnostics report cares about.
		 *
		 * `mapi_state_<instance>` is where `core/state.js` keeps volume, mode, last
		 * song and resume position; `mapi_cookie_consent` is the answer its banner
		 * records, which gates the boot chain. The instance suffix comes from
		 * `data-player-id`, which this plugin pins, so it is derived rather than
		 * hardcoded to keep the two in step.
		 */
		var MIRROR_COOKIE = "mapi_state_" + DEDUP_KEY.replace(/^id:/, "");
		var MIRROR_POS_COOKIE = "mapi_pos";
		var MIRROR_CONSENT_COOKIE = "mapi_cookie_consent";

		/** Whether the jar holds changes the host has not acknowledged. */
		var dirty = false;

		/** @param {string} name cookie name. @returns {string} its value, or `''`. */
		function jarGet(name) {
			var key = String(name);
			return Object.hasOwn(jar, key) ? jar[key] : "";
		}

		/** @param {string} name cookie name. @param {string} value its value. */
		function jarSet(name, value) {
			var key = String(name);
			if (typeof value !== "string" && typeof value !== "number") return;
			var text = String(value);
			if (text.length > 4096) return;
			if (jarGet(key) === text) return;
			jar[key] = text;
			dirty = true;
		}

		/** @param {string} name cookie name. */
		function jarDel(name) {
			var key = String(name);
			if (Object.hasOwn(jar, key)) {
				delete jar[key];
				dirty = true;
			}
		}

		/** Names currently in the jar, for the diagnostics report. */
		function jarNames() {
			return Object.keys(jar).sort();
		}

		/**
		 * Replace the player's cookie seam.
		 *
		 * Runs as soon as an instance appears and again whenever one boots, because
		 * `api.php` builds `MP._` fresh per instance.
		 *
		 * @param {object} instance a player instance from `window.__mapiPlayers`.
		 */
		function installCookieBridge(instance) {
			try {
				var api = instance && instance._;
				if (api === null || api === undefined || typeof api !== "object") return;
				if (api.__dshMsapiBridge === true) return;
				api.__dshMsapiBridge = true;
				api.setCookie = function (name, value) {
					jarSet(name, value);
				};
				api.getCookie = function (name) {
					return jarGet(name);
				};
				api.delCookie = function (name) {
					jarDel(name);
				};
			} catch (error) {
				/* a player whose seam cannot be replaced keeps its own behaviour */
			}
		}

		/**
		 * Ask the host for the saved jar before the player boots.
		 *
		 * Every cookie the host knows goes back into the emulated jar first, so the
		 * player's `loadState` and its consent check both see what the previous
		 * session left behind.
		 *
		 * @returns {Promise<object|null>} the snapshot, when the host answered.
		 */
		function restorePlayerState() {
			return requestJson(STATE_PATH)
				.then(function (result) {
					var body = result.body || {};
					var state = body.ok === true && body.state ? body.state : null;
					var stored =
						state !== null && state.cookies !== null && typeof state.cookies === "object"
							? state.cookies
							: {};
					for (var name in stored) {
						if (Object.hasOwn(stored, name) && typeof stored[name] === "string") {
							jar[name] = stored[name];
						}
					}
					/* Consent gates the whole boot chain: `api.php` runs
					   `verifyKey → showConsentBanner → get-config`, so an unanswered
					   banner stops the player from loading at all — not merely from
					   remembering. Granting it here is what lets the player start in a
					   shell where that banner may not be reachable.
					   Marked dirty when it is new, otherwise the first run would keep
					   the answer in memory only and ask again next launch. */
					if (jarGet(MIRROR_CONSENT_COOKIE) === "") {
						jar[MIRROR_CONSENT_COOKIE] = "granted";
						dirty = true;
					}
					return state;
				})
				.catch(function () {
					if (jarGet(MIRROR_CONSENT_COOKIE) === "") {
						jar[MIRROR_CONSENT_COOKIE] = "granted";
						dirty = true;
					}
					return null;
				});
		}

		/** What the host last acknowledged, for the diagnostics report. */
		var mirrored = { state: null, pos: null, consent: null };

		/**
		 * Push the jar to the host when it changed.
		 *
		 * The player rewrites its state cookie as often as twice a second while
		 * playing, so the dirty flag — not the timer — decides whether a request is
		 * worth making.
		 */
		function mirrorPlayerState() {
			try {
				if (!dirty) return;
				var payload = {};
				for (var name in jar) {
					if (Object.hasOwn(jar, name)) payload[name] = jar[name];
				}
				dirty = false;
				requestJson(STATE_PATH, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ cookies: payload }),
				}).then(
					function (result) {
						var body = (result && result.body) || {};
						if (body.ok === true) {
							mirrored.consent = jarGet(MIRROR_CONSENT_COOKIE);
							mirrored.state = jarGet(MIRROR_COOKIE);
							mirrored.pos = jarGet(MIRROR_POS_COOKIE);
						} else {
							dirty = true;
						}
					},
					function () {
						dirty = true;
					},
				);
			} catch (error) {
				/* memory is a nicety; playback must not depend on it */
			}
		}

		/**
		 * Dismiss the consent banner if it is still on screen.
		 *
		 * With the bridge in place the banner reads the emulated jar, which already
		 * says `granted`, so it should never render. This is the belt for the case
		 * where the player asked before the bridge was installed: leaving it up
		 * would strand the boot chain, so it is accepted on the user's behalf. Only
		 * `granted` is clicked on purpose — silently answering "denied" would be
		 * worse than doing nothing.
		 *
		 * @returns {boolean} whether a banner was found and accepted.
		 */
		function acceptConsentBanner() {
			try {
				var banner = document.getElementById("mapi-consent-overlay");
				if (banner === null) return false;
				var accept = banner.querySelector("#mapi-consent-accept");
				if (accept === null || typeof accept.click !== "function") return false;
				accept.click();
				return true;
			} catch (error) {
				return false;
			}
		}

		/** Start the mirror timer. @returns {Function} a disposer. */
		function startStateMirror() {
			mirrorPlayerState();
			var timer = setInterval(function () {
				acceptConsentBanner();
				installCookieBridge((window.__mapiPlayers || [])[0]);
				mirrorPlayerState();
			}, 4000);
			try {
				window.addEventListener("pagehide", mirrorPlayerState);
			} catch (error) {
				/* nothing to hook */
			}
			return function () {
				clearInterval(timer);
				try {
					window.removeEventListener("pagehide", mirrorPlayerState);
				} catch (error) {
					/* nothing to unhook */
				}
			};
		}
		/**
		 * Report what this bundle observed to the host, as a file.
		 *
		 * When the two halves disagree — the host's routes answer, yet no state
		 * ever arrives — the only useful evidence is the page's own account. It
		 * answers questions no amount of reading source can: did `apply` run, did
		 * the embed script go in, does the jar hold anything, what did the last
		 * host call return.
		 */
		function reportDiagnostics(extra) {
			try {
				var cookieText = "";
				try {
					cookieText = String(document.cookie || "");
				} catch (error) {
					cookieText = "";
				}
				var payload = {
					applied: true,
					href: String(location.href),
					scheme: String(location.protocol),
					realCookiesWork: cookieText !== "",
					scripts: document.querySelectorAll("script[" + SCRIPT_ATTR + "]").length,
					instances: (window.__mapiPlayers || []).length,
					viewport: document.getElementById(VIEWPORT_ID) !== null,
					grip: document.getElementById(GRIP_ID) !== null,
					jar: jarNames(),
					bridge: Boolean((window.__mapiPlayers || [])[0] && (window.__mapiPlayers || [])[0]._ && (window.__mapiPlayers || [])[0]._.__dshMsapiBridge),
					mirrorCookie: MIRROR_COOKIE,
					mirrorConsent: MIRROR_CONSENT_COOKIE,
					dirty: dirty,
					mirrored: { state: mirrored.state, pos: mirrored.pos, consent: mirrored.consent },
					lastCall: lastResult,
					desired: player.desired,
					mirrorTimer: player.stopMirror !== null,
					note: extra === undefined ? "" : String(extra),
				};
				requestJson(DIAGNOSTICS_PATH, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload),
				}).catch(function () {
					/* a missing diagnostics sink must not disturb anything */
				});
			} catch (error) {
				/* same */
			}
		}

		/* ------------------------------------------------------------------ *
		 * player: viewport + embed + teardown
		 * ------------------------------------------------------------------ */

		var player = {
			desired: false,
			script: null,
			observer: null,
			sweepTimer: 0,
			immersiveTimer: 0,
			stopMirror: null,
			/** Extra pixels the user pulled the viewport down by, this session. */
			offset: 0,
		};

		/** @returns {Element|null} the viewport box, creating it when absent. */
		function ensureViewport() {
			var existing = document.getElementById(VIEWPORT_ID);
			if (existing !== null) return existing;
			var viewport = document.createElement("div");
			viewport.id = VIEWPORT_ID;
			viewport.setAttribute("aria-hidden", "true");
			document.body.appendChild(viewport);
			installGrip(viewport);
			applyViewportClearance();
			return viewport;
		}

		/**
		 * Measure the strip DSH reserves for its own caption buttons.
		 *
		 * DSH's preload writes the height as an inline custom property on
		 * `<html>` (`root.style.setProperty("--dsh-windows-titlebar-height",
		 * "40px")`) together with the `data-windows-titlebar` attribute. Both are
		 * absent on macOS, where the traffic lights occupy a fixed 48px strip, and
		 * both are dropped in fullscreen. Reading the property and forcing it to a
		 * positive number means a missing or empty variable can never collapse the
		 * clearance to zero — which is exactly how the player ended up underneath
		 * the caption buttons.
		 *
		 * @returns {number} pixels to keep clear at the top of the viewport.
		 */
		function measureTopClearance() {
			try {
				if (typeof document === "undefined" || !document.documentElement) return 0;
				var root = document.documentElement;
				if (root.hasAttribute("data-fullscreen")) return 0;
				var raw = root.style.getPropertyValue("--dsh-windows-titlebar-height");
				if (!raw) {
					try {
						raw = window.getComputedStyle(root).getPropertyValue("--dsh-windows-titlebar-height");
					} catch (error) {
						raw = "";
					}
				}
				var px = parseFloat(raw);
				if (Number.isFinite(px) && px > 0) return Math.round(px);
				if (root.hasAttribute("data-windows-titlebar")) return 40;
				if (root.getAttribute("data-platform") === "darwin") return 48;
				return 0;
			} catch (error) {
				return 0;
			}
		}

		/**
		 * Push the measured clearance onto the viewport as an inline variable.
		 *
		 * Inline rather than a stylesheet rule: a rule would depend on a selector
		 * matching, and a miss silently restored the overlap.
		 *
		 * Also re-seats the drag handle and re-applies the two patches whose
		 * geometry depends on the clearance, so one call keeps everything in step.
		 */
		function applyViewportClearance() {
			try {
				var viewport = document.getElementById(VIEWPORT_ID);
				if (viewport === null) return;
				var clear = measureTopClearance();
				viewport.style.setProperty("--dms-top-clear", clear + "px");
				var grip = document.getElementById(GRIP_ID);
				if (grip !== null) {
					grip.style.top = clear + player.offset + "px";
					grip.style.left = "0";
					grip.style.right = "0";
				}
				refreshImmersiveLayers();
				refreshLyricStrips();
			} catch (error) {
				/* the default zero clearance stands */
			}
		}

		/**
		 * Give the viewport's top edge a grab handle.
		 *
		 * The box is fixed to the window, so without a handle the only way to move
		 * the player is dragging the player itself — which is useless when it sits
		 * under something. Dragging the handle moves the whole viewport down (or
		 * back up to the caption edge) and is remembered for the session.
		 *
		 * @param {Element} viewport the viewport element.
		 */
		function installGrip(viewport) {
			try {
				if (document.getElementById(GRIP_ID) !== null) return;
				var grip = document.createElement("div");
				grip.id = GRIP_ID;
				grip.setAttribute("role", "separator");
				grip.setAttribute("aria-orientation", "horizontal");
				grip.setAttribute("aria-label", "drag to move the music player area");
				grip.title = "拖动调整播放器区域";
				grip.addEventListener("pointerdown", function (event) {
					var startY = event.clientY;
					var startClear = measureTopClearance();
					var startOffset = player.offset;
					grip.setAttribute("data-dragging", "");
					try {
						grip.setPointerCapture(event.pointerId);
					} catch (error) {
						/* capture is a nicety */
					}
					var onMove = function (moveEvent) {
						var next = startOffset + (moveEvent.clientY - startY);
						var min = 0;
						var max = Math.max(0, window.innerHeight - 160);
						player.offset = Math.min(max, Math.max(min, Math.round(next)));
						viewport.style.setProperty("--dms-top-clear", startClear + player.offset + "px");
						grip.style.top = startClear + player.offset + "px";
						refreshImmersiveLayers();
					};
					var onUp = function () {
						grip.removeAttribute("data-dragging");
						try {
							grip.releasePointerCapture(event.pointerId);
						} catch (error) {
							/* already released */
						}
						grip.removeEventListener("pointermove", onMove);
						grip.removeEventListener("pointerup", onUp);
						grip.removeEventListener("pointercancel", onUp);
					};
					grip.addEventListener("pointermove", onMove);
					grip.addEventListener("pointerup", onUp);
					grip.addEventListener("pointercancel", onUp);
					event.preventDefault();
				});
				document.body.appendChild(grip);
				applyViewportClearance();
			} catch (error) {
				/* a missing handle only means the area cannot be re-positioned */
			}
		}

		/**
		 * Push the current clearance into a player's shadow tree.
		 *
		 * The immersive layer is `position: fixed; inset: 0` and its close button
		 * sits at the very top (`top: 0`, inside a 60px bar). Because the viewport
		 * clips exactly that strip, the button is the first thing to disappear —
		 * the layer has to start below the caption instead of behind it.
		 *
		 * The player builds its shadow root with `mode: "closed"`, so no outside
		 * selector can reach the layer. What is still reachable is the reference the
		 * player keeps on itself (`MP._hostRoot`, the value `attachShadow` returned),
		 * so the fix is a style element appended into that tree. `inset` is rebuilt
		 * from the four physical sides: the layer's own `padding` is vertical and is
		 * left alone.
		 *
		 * @param {object} instance a player instance from `window.__mapiPlayers`.
		 * @param {number} clearance pixels reserved at the top by DSH's caption.
		 */
		function patchImmersiveLayer(instance, clearance) {
			try {
				var root = instance && instance._hostRoot;
				if (root === null || root === undefined || typeof root.querySelector !== "function") return;
				var tag = root.querySelector("style[" + SHADOW_STYLE_ATTR + "]");
				if (tag === null) {
					tag = document.createElement("style");
					tag.setAttribute(SHADOW_STYLE_ATTR, "1");
					root.appendChild(tag);
				}
				var top = clearance + player.offset;
				/* The layer carries its own vertical padding (`52px` at the top in the
				   shipped skins). Since it now starts below the caption, that padding
				   would push the close button a caption-height too far down. Zeroing the
				   top padding on the layer and re-applying it to the close area keeps the
				   button exactly where the skin author put it, relative to the layer's
				   new top edge. */
				tag.textContent =
					'[data-mp="immersiveOverlay"]{' +
					"top:" + top + "px!important;right:0!important;bottom:0!important;left:0!important;" +
					"padding-top:0!important;" +
					"}";
				if (top > 0) {
					tag.textContent +=
						'[data-mp="immersiveOverlay"]>.im-close-area{' +
						"top:" + top + "px!important;" +
						"}";
				}
			} catch (error) {
				/* a player without a shadow root keeps its own layout */
			}
		}

		/**
		 * Restore the box model the lyric strip's width arithmetic assumes.
		 *
		 * The strip is a `position: fixed` element appended to the *page* body (the
		 * skins use a closed shadow root, so core keeps it outside), and core sizes
		 * it as `width = span.scrollWidth + 42` on every line change.
		 *
		 * On a Msapi page that number is the box's **total** width, because the
		 * site stylesheet sets `*, *::before, *::after { box-sizing: border-box }`
		 * (`assets/css/pc.css`). The 42 is `padding: 6px 20px` (40 horizontal) plus a
		 * 2px breath.
		 *
		 * Embedded in DSH the strip inherits no such reset, so the same declaration
		 * means **content** width: 40px of padding is added on top and the pill
		 * renders `scrollWidth + 82` wide against `scrollWidth + 42` of text. That
		 * surplus is the gap after the words, and the mismatched aspect is what makes
		 * the pill look deformed.
		 *
		 * So the fix is to give the strip the same box model its own page gives it,
		 * not to change the arithmetic. `padding` is re-asserted because core rewrites
		 * it to `6px 0` while the strip is collapsed, and the horizontal value has to
		 * come back for the 40 to keep meaning 40.
		 *
		 * @param {Element} element the `[data-mp="lrc"]` strip.
		 */
		function patchLyricStrip(element) {
			try {
				if (element === null || element === undefined) return;
				if (element.getAttribute(LRC_PATCHED_ATTR) === "1") return;
				element.setAttribute(LRC_PATCHED_ATTR, "1");
				element.style.setProperty("box-sizing", "border-box", "important");
			} catch (error) {
				/* an unpatched strip still renders, just with the surplus width */
			}
		}

		/**
		 * Patch every lyric strip currently in the page.
		 *
		 * The strip is created lazily (on the first line that needs showing) and is
		 * re-owned per instance, so this runs whenever a player host arrives and on
		 * a short poll, exactly like the immersive patch.
		 */
		function refreshLyricStrips() {
			try {
				var strips = document.querySelectorAll('[data-mp="lrc"]');
				for (var i = 0; i < strips.length; i += 1) patchLyricStrip(strips[i]);
			} catch (error) {
				/* nothing to patch */
			}
		}

		/**
		 * Re-apply the immersive patch to every live instance.
		 *
		 * Called whenever the clearance changes, so entering fullscreen or dragging
		 * the handle moves the close button with the rest of the layer.
		 */
		function refreshImmersiveLayers() {
			var clearance = measureTopClearance();
			var list = window.__mapiPlayers;
			if (!Array.isArray(list)) return;
			for (var i = 0; i < list.length; i += 1) {
				patchImmersiveLayer(list[i], clearance);
			}
		}

		/**
		 * Retry the immersive patch for a few seconds after a host appears.
		 *
		 * The player inserts its host into the document *before* the module that
		 * pushes the instance object finishes, so the first attempt can land on an
		 * empty `__mapiPlayers`. Polling briefly is cheaper and far more robust than
		 * guessing the exact ordering inside someone else's bundle.
		 */
		function scheduleImmersiveRetry() {
			if (player.immersiveTimer) return;
			var attempts = 0;
			var tick = function () {
				player.immersiveTimer = 0;
				attempts += 1;
				/* The cookie bridge has to land before the player's first `loadState`,
				   and the instance only exists a moment after its host. */
				var list = window.__mapiPlayers || [];
				for (var b = 0; b < list.length; b += 1) installCookieBridge(list[b]);
				refreshImmersiveLayers();
				refreshLyricStrips();
				var patched = false;
				if (Array.isArray(list)) {
					for (var i = 0; i < list.length; i += 1) {
						var root = list[i] && list[i]._hostRoot;
						if (root && typeof root.querySelector === "function" && root.querySelector("style[" + SHADOW_STYLE_ATTR + "]") !== null) {
							patched = true;
							break;
						}
					}
				}
				/* Keep looking while something is still missing: the shadow patch may
				   not have landed yet, and the lyric strip is created lazily on the
				   first lyric line, so it can appear well after the player starts. */
				var strips = document.querySelectorAll('[data-mp="lrc"]');
				if ((!patched || strips.length === 0) && attempts < 40) {
					player.immersiveTimer = setTimeout(tick, 250);
				}
			};
			player.immersiveTimer = setTimeout(tick, 250);
		}

		/**
		 * Lift a freshly arrived player host above the composer.
		 *
		 * The player docks itself at `bottom: 50px`, which lands on top of DSH's
		 * input row. A stylesheet rule cannot fix that without `!important`, and
		 * `!important` would also beat the user's own drag afterwards, so the
		 * offset is applied once here — only while the host is still bottom-anchored
		 * — and never touched again.
		 *
		 * @param {Element} host the player's host element.
		 */
		function liftAboveComposer(host) {
			try {
				if (host.style.bottom === "" || host.style.bottom === "auto") return;
				if (parseFloat(host.style.bottom) >= COMPOSER_CLEARANCE_PX) return;
				host.style.bottom = COMPOSER_CLEARANCE_PX + "px";
				if (typeof host.style.right === "string" && host.style.right !== "" && host.style.right !== "auto") {
					var right = parseFloat(host.style.right);
					if (Number.isFinite(right) && right < 16) host.style.right = "16px";
				}
			} catch (error) {
				/* the player keeps its own placement */
			}
		}

		/**
		 * Watch `document.body` for the player's own nodes.
		 *
		 * The player appends `#mapi-player-xxxxx` (and its toast layer) to the body
		 * only after its config request lands, so there is no event to hook: an
		 * observer is the only honest way to catch it. While the player is wanted,
		 * each arrival is moved into the viewport; while it is not, each arrival is
		 * removed — that sweeps up an instance whose script booted after the user
		 * already switched the player off.
		 */
		function startObserver() {
			if (player.observer !== null) return;
			if (typeof MutationObserver === "undefined") return;
			player.observer = new MutationObserver(function (records) {
				for (var i = 0; i < records.length; i += 1) {
					var added = records[i].addedNodes;
					for (var j = 0; j < added.length; j += 1) {
						var node = added[j];
						if (node === null || node.nodeType !== 1) continue;
						var id = node.id || "";
						var mine = id.indexOf("mapi-player-") === 0 || id === "mapi-notices";
						if (!mine) continue;
						if (player.desired) {
							var viewport = document.getElementById(VIEWPORT_ID);
							if (viewport !== null && node.parentNode !== viewport) {
								try {
									viewport.appendChild(node);
									if (id.indexOf("mapi-player-") === 0) {
										liftAboveComposer(node);
										/* The instance object is pushed after its host, so
										   the bridge is installed by the retry loop as well. */
										installCookieBridge((window.__mapiPlayers || [])[0]);
										refreshImmersiveLayers();
										scheduleImmersiveRetry();
									}
								} catch (error) {
									/* the node moved again; the next record catches it */
								}
							}
						} else {
							try {
								node.remove();
							} catch (error) {
								/* already detached */
							}
						}
					}
				}
			});
			player.observer.observe(document.body, { childList: true });
		}

		/**
		 * @param {number} [graceMs] keep observing for a while so a late instance is
		 *   still swept; 0 stops immediately.
		 */
		function stopObserver(graceMs) {
			if (player.sweepTimer) {
				clearTimeout(player.sweepTimer);
				player.sweepTimer = 0;
			}
			var finish = function () {
				if (player.observer !== null) {
					try {
						player.observer.disconnect();
					} catch (error) {
						/* already gone */
					}
					player.observer = null;
				}
			};
			if (!graceMs) {
				finish();
				return;
			}
			player.sweepTimer = setTimeout(function () {
				player.sweepTimer = 0;
				finish();
			}, graceMs);
		}

		/**
		 * Destroy our player instance and drop everything the embed left behind.
		 *
		 * `destroy()` flips the player's own `_destroyed` flag first, which is what
		 * stops its in-flight requests from building UI after we are gone.
		 */
		function destroyInstances() {
			var list = window.__mapiPlayers;
			if (Array.isArray(list)) {
				for (var i = list.length - 1; i >= 0; i -= 1) {
					var instance = list[i];
					if (instance === null || typeof instance !== "object") continue;
					if (!instance._ || instance._.DEDUP_KEY !== DEDUP_KEY) continue;
					try {
						if (typeof instance.destroy === "function") instance.destroy();
					} catch (error) {
						/* a half-built instance still has to go */
					}
					try {
						var host = instance._hostRoot && instance._hostRoot.host;
						if (host && host.parentNode) host.parentNode.removeChild(host);
					} catch (error) {
						/* already detached */
					}
					try {
						list.splice(i, 1);
					} catch (error) {
						/* a frozen array is not worth a throw */
					}
				}
			}
			var scripts = document.querySelectorAll("script[" + SCRIPT_ATTR + "]");
			for (var s = 0; s < scripts.length; s += 1) {
				try {
					scripts[s].remove();
				} catch (error) {
					/* already gone */
				}
			}
			var notices = document.getElementById("mapi-notices");
			if (notices && notices.parentNode) {
				try {
					notices.parentNode.removeChild(notices);
				} catch (error) {
					/* already gone */
				}
			}
			var strays = document.querySelectorAll("[id^='mapi-player-']");
			for (var k = 0; k < strays.length; k += 1) {
				try {
					strays[k].remove();
				} catch (error) {
					/* already gone */
				}
			}
		}

		/**
		 * Mount (or re-point) the player at an embed URL.
		 *
		 * The cookie restore is awaited first: the player reads its memory once,
		 * while booting, so writing the cookie afterwards would be too late.
		 *
		 * @param {string} src the script URL the host built.
		 */
		function mountPlayer(src) {
			if (typeof document === "undefined" || !document.body) return;
			player.desired = true;
			installStyles();
			ensureViewport();
			startObserver();
			var current = document.querySelector("script[" + SCRIPT_ATTR + "]");
			if (current !== null && current.getAttribute("src") === src) return;
			destroyInstances();

			var inject = function () {
				if (!player.desired) return;
				var script = document.createElement("script");
				script.src = src;
				script.async = true;
				script.setAttribute(SCRIPT_ATTR, "1");
				document.body.appendChild(script);
				player.script = script;
				if (!player.stopMirror) player.stopMirror = startStateMirror();
				scheduleImmersiveRetry();
			};

			restorePlayerState().then(inject, inject);

		}

		/** Tear the player down and leave nothing behind. */
		function unmountPlayer() {
			if (typeof document === "undefined") return;
			player.desired = false;
			destroyInstances();
			var viewport = document.getElementById(VIEWPORT_ID);
			if (viewport && viewport.parentNode) {
				try {
					viewport.parentNode.removeChild(viewport);
				} catch (error) {
					/* already gone */
				}
			}
			var grip = document.getElementById(GRIP_ID);
			if (grip && grip.parentNode) {
				try {
					grip.parentNode.removeChild(grip);
				} catch (error) {
					/* already gone */
				}
			}
			player.script = null;
			if (typeof player.stopMirror === "function") {
				player.stopMirror();
				player.stopMirror = null;
			}
			stopObserver(12000);
		}

		/**
		 * Re-measure the caption strip when the window changes.
		 *
		 * Entering or leaving fullscreen drops or restores the caption, and the
		 * height itself can change with the display scale, so a value read once at
		 * mount would eventually be wrong in both directions.
		 *
		 * @returns {Function} a disposer.
		 */
		function watchViewportClearance() {
			var reapply = function () {
				applyViewportClearance();
			};
			var observer = null;
			try {
				if (typeof MutationObserver === "function" && document.documentElement) {
					observer = new MutationObserver(reapply);
					observer.observe(document.documentElement, {
						attributes: true,
						attributeFilter: ["data-fullscreen", "data-windows-titlebar", "style"],
					});
				}
			} catch (error) {
				observer = null;
			}
			try {
				window.addEventListener("resize", reapply);
			} catch (error) {
				/* nothing to hook */
			}
			return function () {
				try {
					if (observer !== null) observer.disconnect();
				} catch (error) {
					/* already disconnected */
				}
				try {
					window.removeEventListener("resize", reapply);
				} catch (error) {
					/* nothing to unhook */
				}
				if (player.immersiveTimer) {
					clearTimeout(player.immersiveTimer);
					player.immersiveTimer = 0;
				}
			};
		}

		/**
		 * Ask the host whether the player should be on, and act on the answer.
		 *
		 * @returns {Promise<object|null>} the host's view, when it answered.
		 */
		function syncMount() {
			return requestJson(PLAYER_PATH)
				.then(function (result) {
					var body = result.body || {};
					if (body.ok !== true) {
						unmountPlayer();
						return null;
					}
					if (body.enabled === true && typeof body.src === "string" && body.src !== "") {
						mountPlayer(body.src);
					} else {
						unmountPlayer();
					}
					return body.view || null;
				})
				.catch(function () {
					/* the host is not reachable: say nothing, mount nothing */
					return null;
				});
		}

		/* ------------------------------------------------------------------ *
		 * settings page
		 * ------------------------------------------------------------------ */

		/**
		 * Map a probe result onto a dot tone and a sentence.
		 *
		 * @param {object} t copy table.
		 * @param {object|null} probe the probe result.
		 * @returns {{tone: string, text: string}} the status line.
		 */
		function statusOf(t, probe) {
			if (probe === null || probe === undefined) return { tone: "idle", text: t.notTested };
			if (probe.reachable !== true) {
				return { tone: "error", text: t.unreachable + (probe.message ? "（" + probe.message + "）" : "") };
			}
			if (probe.keyState === "ok") {
				return {
					tone: "ok",
					text: probe.playlists > 0 ? t.probeOk(probe) : t.probeNoPlaylist(probe),
				};
			}
			if (probe.keyState === "invalid") return { tone: "error", text: t.invalidKey };
			if (probe.keyState === "disabled") return { tone: "error", text: t.keyDisabled };
			if (probe.keyState === "missing") return { tone: "warn", text: t.missingKey };
			return { tone: "warn", text: t.unknownState };
		}

		/** The Settings page: two inputs, three buttons, one status line. */
		function MsapiSettingsPage() {
			var t = copy();
			var alive = React.useRef(true);
			var statePair = React.useState({ phase: "loading", view: null, error: "" });
			var state = statePair[0];
			var setState = statePair[1];
			var urlPair = React.useState("");
			var url = urlPair[0];
			var setUrl = urlPair[1];
			var keyPair = React.useState("");
			var key = keyPair[0];
			var setKey = keyPair[1];
			var probePair = React.useState(null);
			var probe = probePair[0];
			var setProbe = probePair[1];
			var busyPair = React.useState("");
			var busy = busyPair[0];
			var setBusy = busyPair[1];
			var messagePair = React.useState("");
			var message = messagePair[0];
			var setMessage = messagePair[1];

			var load = React.useCallback(function () {
				requestJson(SETTINGS_PATH)
					.then(function (result) {
						if (!alive.current) return;
						var body = result.body || {};
						if (body.ok !== true) throw new Error(body.error || t.loadFailed);
						var view = body.view || {};
						setState({ phase: "ready", view: view, error: "" });
						setUrl(view.url || "");
						setProbe(view.lastProbe || null);
					})
					.catch(function (error) {
						if (!alive.current) return;
						setState({
							phase: "error",
							view: null,
							error: String((error && error.message) || error),
						});
					});
			}, []);

			React.useEffect(function () {
				load();
				return function () {
					alive.current = false;
				};
			}, [load]);

			var afterChange = function (view, nextProbe) {
				setState({ phase: "ready", view: view, error: "" });
				setUrl(view.url || "");
				setProbe(nextProbe === undefined ? view.lastProbe || null : nextProbe);
				syncMount();
			};

			var save = function () {
				if (busy !== "") return;
				setBusy("save");
				setMessage("");
				var payload = { url: url };
				if (key !== "") payload.key = key;
				requestJson(SETTINGS_PATH, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload),
				})
					.then(function (result) {
						if (!alive.current) return;
						var body = result.body || {};
						if (body.ok !== true) throw new Error(body.error || t.saveFailed);
						setKey("");
						setMessage(t.saved);
						afterChange(body.view || {}, body.probe || null);
					})
					.catch(function (error) {
						if (!alive.current) return;
						setMessage(String((error && error.message) || error));
					})
					.finally(function () {
						if (alive.current) setBusy("");
					});
			};

			var test = function () {
				if (busy !== "") return;
				setBusy("test");
				setMessage("");
				var payload = { url: url };
				if (key !== "") payload.key = key;
				requestJson(PROBE_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload),
				})
					.then(function (result) {
						if (!alive.current) return;
						var body = result.body || {};
						if (body.ok !== true) throw new Error(body.error || t.saveFailed);
						setProbe(body.probe || null);
					})
					.catch(function (error) {
						if (!alive.current) return;
						setMessage(String((error && error.message) || error));
					})
					.finally(function () {
						if (alive.current) setBusy("");
					});
			};

			var togglePlayer = function () {
				if (busy !== "" || state.view === null) return;
				setBusy("player");
				var wanted = state.view.enabled !== true;
				requestJson(PLAYER_PATH, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ enabled: wanted }),
				})
					.then(function (result) {
						if (!alive.current) return;
						var body = result.body || {};
						if (body.ok !== true) throw new Error(body.error || t.saveFailed);
						afterChange(body.view || {}, undefined);
					})
					.catch(function (error) {
						if (!alive.current) return;
						setMessage(String((error && error.message) || error));
					})
					.finally(function () {
						if (alive.current) setBusy("");
					});
			};

			if (state.phase === "loading") {
				return h("p", { className: "dms-hint" }, t.loading);
			}
			if (state.phase === "error") {
				return h(
					"div",
					{ className: "dms-page" },
					h("p", { className: "dms-error" }, t.loadFailed + " — " + state.error),
				);
			}

			var view = state.view || {};
			var root = (view.defaults && view.defaults.root) || "https://msapi.bmwy72.top";
			var status = statusOf(t, probe);
			var keyHint;
			if (key !== "") keyHint = t.keyHintTyping;
			else if (view.keyConfigured === true) keyHint = t.keyHintSaved(view);
			else keyHint = t.keyHintEmpty;

			var field = function (label, control, hint, bad) {
				return h(
					"label",
					{ className: "dms-field" },
					h("span", { className: "dms-field__label" }, label),
					control,
					h("span", { className: "dms-hint" + (bad ? " dms-hint--error" : "") }, hint),
				);
			};

			return h(
				"section",
				{ className: "dms-page" },
				h("p", { className: "dms-intro" }, t.intro),
				h(
					"div",
					{ className: "dms-card" },
					field(
						t.urlLabel,
						h("input", {
							className: "dms-input",
							type: "url",
							inputMode: "url",
							spellCheck: false,
							autoComplete: "off",
							placeholder: t.urlPlaceholder,
							value: url,
							disabled: busy !== "",
							onChange: function (event) {
								setUrl(event.target.value);
							},
						}),
						view.urlError ? view.urlError : t.urlHint(root),
						Boolean(view.urlError),
					),
					field(
						t.keyLabel,
						h("input", {
							className: "dms-input",
							type: "password",
							spellCheck: false,
							autoComplete: "off",
							placeholder: t.keyPlaceholder,
							value: key,
							disabled: busy !== "",
							onChange: function (event) {
								setKey(event.target.value);
							},
						}),
						keyHint,
						false,
					),
					h(
						"div",
						{ className: "dms-status" },
						h("span", { className: "dms-dot" + (status.tone === "idle" ? "" : " dms-dot--" + status.tone) }),
						h("span", null, status.text),
					),
					h(
						"div",
						{ className: "dms-actions" },
						h(
							"button",
							{
								type: "button",
								className: "dms-btn dms-btn--primary",
								disabled: busy !== "",
								onClick: save,
							},
							busy === "save" ? t.saving : t.save,
						),
						h(
							"button",
							{ type: "button", className: "dms-btn", disabled: busy !== "", onClick: test },
							busy === "test" ? t.testing : t.test,
						),
						h("div", { style: { flex: "1 0 0" } }),
						h(
							"button",
							{ type: "button", className: "dms-btn", disabled: busy !== "", onClick: togglePlayer },
							view.enabled === true ? t.disablePlayer : t.enablePlayer,
						),
					),
					message ? h("p", { className: "dms-error" }, message) : null,
				),
				h(
					"div",
					{ className: "dms-card" },
					h(
						"div",
						{ className: "dms-status" },
						h("span", {
							className: "dms-dot" + (view.enabled === true && view.keyConfigured === true ? " dms-dot--ok" : " dms-dot--warn"),
						}),
						h(
							"span",
							null,
							view.enabled === true
								? view.keyConfigured === true
									? t.playerOn
									: t.playerNeedsKey
								: t.playerOff,
						),
					),
				),
			);
		}

		/* ------------------------------------------------------------------ *
		 * registration
		 * ------------------------------------------------------------------ */

		/**
		 * Register the Settings page. A failed registration costs a page, so it
		 * must never break the plugin.
		 *
		 * @param {object} ctx the browser cordis context.
		 */
		function registerSettingsSection(ctx) {
			try {
				ctx.slots.inject(SETTINGS_SLOT, function () {
					return ctx.slots.register(
						{
							name: SETTINGS_SLOT,
							id: ENTRY_ID,
							order: ENTRY_ORDER,
							label: function () {
								return copy().navLabel;
							},
						},
						MsapiSettingsPage,
					);
				});
			} catch (error) {
				try {
					console.error("[" + PACKAGE_ID + "] settings section registration failed:", error);
				} catch (ignored) {
					/* nothing to do */
				}
			}
		}

		/**
		 * @param {object} ctx the browser cordis context.
		 */
		function apply(ctx) {
			installStyles();
			registerSettingsSection(ctx);
			if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
				if (document.body) window.setTimeout(syncMount, 0);
				else document.addEventListener("DOMContentLoaded", function () {
					syncMount();
				}, { once: true });
			}
			/* First report as early as possible: if this never reaches the host, the
			   bundle did not run at all, which is a different problem entirely. */
			if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
				window.setTimeout(function () {
					reportDiagnostics("apply");
				}, 1500);
				window.setTimeout(function () {
					reportDiagnostics("settled");
				}, 8000);
			}
			/* The caption strip changes with fullscreen and display scale, so the
			   clearance is re-measured rather than read once. */
			var stopWatching = null;
			try {
				stopWatching = watchViewportClearance();
			} catch (error) {
				stopWatching = null;
			}
			try {
				if (typeof ctx.effect === "function") {
					ctx.effect(function () {
						return function () {
							if (typeof stopWatching === "function") stopWatching();
							unmountPlayer();
						};
					}, "dsh-msapi: player teardown");
				}
			} catch (error) {
				/* a missing effect seam only means the page reload cleans up instead */
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.__internals = {
			CSS: CSS,
			apiUrl: apiUrl,
			copy: copy,
			statusOf: statusOf,
			MsapiSettingsPage: MsapiSettingsPage,
			VIEWPORT_ID: VIEWPORT_ID,
			DEDUP_KEY: DEDUP_KEY,
			SETTINGS_PATH: SETTINGS_PATH,
			PROBE_PATH: PROBE_PATH,
			PLAYER_PATH: PLAYER_PATH,
			SETTINGS_SLOT: SETTINGS_SLOT,
			ENTRY_ID: ENTRY_ID,
			ENTRY_ORDER: ENTRY_ORDER,
		};
		return module.exports;
	},
});
