# Implementation log

## 2026-10-26

Built v0.1.0 following `plan.md`.

### Layout

```
server/index.js      config and startup
server/app.js        HTTP API, validation, Host and Origin checks, dedupe, TTL
server/discord.js    Discord IPC wrapper (@xhayper/discord-rpc), reconnect, dry-run
server/app.test.js   13 tests against a fake presence backend
extension/           MV3: content.js, background.js, popup.html, popup.js, manifest.json
scripts/rpi-status.mjs
```

### Verified here

- `npm test`: 13 of 13 pass (layout fields, dedupe, validation, foreign Origin, bad Host, TTL clear, body limit).
- Syntax check on all extension scripts and manifest.
- Server run end to end with curl in dry-run mode: health, presence, clear, foreign Origin rejected.
- Real Discord client path: logs that Discord is unreachable and retries every 10 seconds when no Discord app is running.

### Not verified (needs the user's machine)

- Rich Presence actually rendering in Discord with the real Application ID and art asset.
- Extension loaded in Chrome on a live problem page.
- LeetCode GraphQL response shape (`questionFrontendId`, `title`, `difficulty`). This is the most likely thing to need a tweak.

### Design notes

- Extension composes the text, the server only validates and adds assets. Hide-title is applied in the background worker so toggling it takes effect without waiting for a heartbeat.
- Heartbeat every 20 seconds, server TTL 90 seconds. Identical heartbeats do not re-send to Discord because of its update rate limit.
- Start time is kept in `sessionStorage` per slug so a reload does not reset the timer.

## 2026-10-26 (later): first real run

Symptom: server connected to Discord, but the profile only showed the VS Code activity. No LeetCode card.

Findings:
- Server was silent in non-dry-run mode, so a missing presence and a rejected one looked the same. Now logs `Presence: ...`, `Presence cleared` and `Rejected ...`.
- Added `chain.test.js`: runs the real content.js and background.js against the real server with stubbed browser APIs. 8 tests pass, so the code path is sound in a Chromium-like environment. Suspects moved to the environment: extension not loaded in the browser being used, or the tab not refreshed after loading.
- Hardened: `chrome.storage.session` is optional now (falls back to local storage, with a 2 minute age limit on the saved last presence).
- Popup now shows server reachability, time of last presence received by the server, and the extension's last update result.
- Root `package.json` forwards `setup`, `start`, `dry`, `test`, `rpi` to the right folders. The first run failed on `cd server` and `scripts/rpi-status.mjs` because commands were run from inside `server/`.

## 2026-10-26 (later still): Firefox

The user has no Chrome. The browser in the screenshot looks Firefox-based (zoom badge in the URL bar, "Import bookmarks" prompt).

- Server accepted only `chrome-extension://` origins, so a Firefox extension (`moz-extension://`) would have been rejected with 403. Now also accepts `moz-extension://` and `safari-web-extension://`.
- Server now answers CORS preflight and sets `Access-Control-Allow-Origin` for extension origins only, so it still works if Firefox has not granted the 127.0.0.1 host permission.
- Manifest: both `background.service_worker` (Chromium) and `background.scripts` (Firefox), plus `browser_specific_settings.gecko`. Version 0.1.1.
- Tests: 23 pass. Not run in a real Firefox from here.
