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

## 2026-10-26 (afternoon): permanent run

The user confirmed it works and asked to deploy it on GitHub or Vercel.

- Not possible as asked: Rich Presence is set over the Discord app's local IPC, so the setter must run on the same machine. A cloud host cannot do it. Driving the account with a user token from a server would violate Discord's terms, so it was not built.
- Instead: `scripts/service.mjs` installs a launchd LaunchAgent (RunAtLoad, KeepAlive) so the server runs without a terminal. It refuses to install from Downloads, Desktop or Documents because macOS blocks background processes there. It uses `process.execPath`, so nvm paths work, and it aborts if a manual server already holds port 47391.
- `scripts/pack.mjs` builds a Firefox zip (no service_worker key) and a Chromium zip (no gecko keys) for signing or sharing.
- Tests: 29 pass. `launchctl` and AMO signing are untested because they need the user's Mac and account.

## 2026-10-26 (midday): reconnect loop found in the background service

Symptom from `npm run service:status`: the log showed "Connected to Discord" then "Discord disconnected, will retry" about 10 seconds later, repeating, with "Discord not reachable (Connection ended)" in between. Status stayed "connecting".

Cause: `connect()` destroyed the previous client. In `@xhayper/discord-rpc`, destroying a client with an open connection closes it and emits a late `disconnected`. The handler scheduled another retry, which destroyed the new healthy client, and so on forever. "Connection ended" is the library's message for a login that was destroyed while still in progress. Once started, by any single failure, the loop sustained itself. It stayed hidden in the first manual runs because they connected once and never failed.

Fix: `discord.js` tracks a generation number and ignores events from retired clients, never starts a new connection while one is healthy, and no longer waits on or listens to the old client.

Test: `discord.test.js` models the library behavior. The loop test made 30 clients in 600 ms on the old code and 2 on the new code. Total 34 tests pass. Not yet confirmed against the user's real Discord.

## 2026-10-26 (evening): topics on the card

Request: show the main topics (Heap, Priority Queue, ...) on the card, short, because some problems have many tags.

- `content.js` asks GraphQL for `topicTags { name }` and sends `topics`. If LeetCode rejects that field, it retries with the basic query so the card still works without topics.
- `background.js` builds the second line: `Hard · Heap/PQ, Segment Tree, BIT`. Rules: at most 3 topics, about 30 characters for the topic names (tags that do not fit are skipped for a shorter one further down), core technique tags first, generic tags (Array, String, Math, ...) last, long names shortened through a map. Toggle `showTopics` (default on) in the popup, applied immediately.
- The server needed no change: `state` already allows 128 characters.
- Tests: 9 new chain tests (ordering, cap, shortening, budget, no tags, toggle, field-rejected fallback). 43 pass.
- Not verified: the `topicTags` shape on the live LeetCode GraphQL, and how Discord truncates the line on the real profile card. Manifest version 0.1.2.

## 2026-10-26 (night): card still missing after the topics update

Symptom: reloaded the extension, still no card. Page URL (`/problems/<slug>/submissions/<id>/`) matches the slug pattern, so the page is not the problem.

Likely causes, both environment side and unconfirmed:
- Firefox MV3 does not grant host permissions at install. Without them the content script is never injected into leetcode.com. Grants are often lost when a temporary add-on is removed and loaded again.
- The temporary add-on entry still points to the deleted `~/Downloads/leetcode-rpc/extension`, so Reload fails and the browser keeps old code.

Change (v0.1.3): the popup now shows the loaded Version and `Site access: granted / NOT granted`, with a Grant access button that calls `permissions.request` for leetcode.com and 127.0.0.1:47391. `popup.test.js` (4 tests, real popup.js with a DOM stub) covers it. Total 47 pass.

## 2026-10-26 (night, later): server found stopped

The popup (v0.1.3) showed Site access granted and NetworkError on every request, so the extension was fine and the server was down. The log showed the server did receive `Presence: 973. K Closest Points to Origin | Medium` at 8:51 and 8:59 PM, then nothing: no crash trace (stderr goes to the same log) and no restart line, so the process was stopped or unloaded from launchd, not crashed.

Change: `server/index.js` now logs `Stopping (SIGTERM|SIGINT)` and logs unhandled rejections instead of dying. Next time a silent stop will explain itself. Recovery is `npm run service:install`.

Known behavior to decide on: the content script only sends heartbeats while the tab is visible, and Firefox reports a fully covered window as hidden. After 90 s without a heartbeat the card clears (seen at 8:56:53 PM).

## 2026-10-29: link the problem on the card

Request (from a friend's suggestion): make the question linkable.

- `server/app.js`: when the payload has a valid problem URL (already restricted to `https://leetcode.com/problems/<slug>/`), the activity gets `detailsUrl` (title becomes clickable) and, if an image asset is set, `largeImageUrl`. `@xhayper/discord-rpc` 1.5.1 maps these to `details_url` and `assets.large_url`.
- `LINK_PROBLEM=0` in `server/.env` turns it off. Hide title sends no URL, so no link either. `SHOW_BUTTON=1` stays available as the fallback.
- Tests: 4 new (links present, off switch, no link without a valid URL, title-only without image asset). 51 pass.
- Not verified: that the user's Discord client renders and opens the links. Needs the user's machine. Requires `npm run service:install` to restart the server.
