# LeetCode Discord Presence

Shows the problem you are working on as your Discord activity:

```
Playing
LeetCode
218. The Skyline Problem
Hard - Heap/PQ, Segment Tree, BIT
00:12:41
```

Two parts:

- `extension/`: browser extension (MV3, Chromium and Firefox). Reads the problem from the page and sends it to the local server.
- `server/`: small Node server on `127.0.0.1:47391`. Talks to the Discord desktop app over IPC.

Discord only accepts Rich Presence from a local process, which is why the server exists.

## Setup

### 1. Discord application

In the Discord Developer Portal, open your application:

- Name it exactly `LeetCode`. The name is the bold title on the card and cannot be set from code.
- Copy the Application ID (General Information).
- Upload an image under Rich Presence > Art Assets and name it `leetcode` (or set `LARGE_IMAGE_KEY`).

In the Discord app, make sure Settings > Activity Privacy > Share my activity is on.

### 2. Server

Run everything from the project root (the folder that contains `server/` and `extension/`):

```bash
npm run setup                          # installs server dependencies
cp server/.env.example server/.env     # then set DISCORD_CLIENT_ID in server/.env
npm start
```

Keep it running while you practice. The terminal prints a line every time a problem is received (`Presence: 1. Two Sum | Medium`). Without a Client ID it runs in dry-run mode and only prints what it would send (`npm run dry`).

Needs Node 18 or newer and the Discord desktop app running on the same machine.

### 3. Extension

**Firefox, Zen and other Firefox-based browsers** (Firefox 128 or newer):

1. Open `about:debugging#/runtime/this-firefox`.
2. Click Load Temporary Add-on and select `extension/manifest.json`.
3. If a permissions prompt appears, allow it. If the popup later shows `NetworkError`, open `about:addons`, select the extension, go to Permissions and turn on access for `127.0.0.1` and `leetcode.com`.
4. Open (or refresh) any `https://leetcode.com/problems/...` page.

A temporary add-on is removed when the browser quits, so repeat steps 1 and 2 after a restart. For a permanent install, sign it as an unlisted add-on on addons.mozilla.org (free) and open the resulting `.xpi`.

**Chrome, Edge, Brave, Arc:**

1. Open `chrome://extensions` and turn on Developer mode.
2. Click Load unpacked and select the `extension/` folder.
3. Open (or refresh) any `https://leetcode.com/problems/...` page.

Safari is not supported.

The toolbar popup has three toggles (show on Discord, hide problem title, show topics) and shows whether the server and Discord are connected.

## Run it permanently

Discord only accepts Rich Presence from a program on your own computer, through the Discord app's local connection. Vercel, GitHub Pages and other hosts cannot set it for you, so the permanent setup has two local pieces: the server runs in the background at login, and the extension is installed permanently.

### Server: start at login (macOS)

macOS blocks background programs from reading `Downloads`, `Desktop` and `Documents`, so move the project first:

```bash
mv ~/Downloads/leetcode-rpc ~/leetcode-rpc
cd ~/leetcode-rpc
# stop any `npm start` that is still running (Ctrl+C), then:
npm run service:install
npm run service:status
```

- It starts now, starts at every login, and restarts if it crashes. Logs go to `~/Library/Logs/leetcode-rpc.log`.
- It uses the Node that runs the install. If you later switch Node versions (nvm), run `npm run service:install` again.
- After editing `server/.env` or the code, run `npm run service:install` again to restart it.
- `npm run service:uninstall` removes it.
- If Discord is closed, the server keeps retrying and connects when Discord starts.

### Extension: install permanently

```bash
npm run pack      # writes dist/leetcode-rpc-firefox-<version>.zip and dist/leetcode-rpc-chromium-<version>.zip
```

Firefox and Zen delete temporary add-ons on quit. To keep it:

1. Go to addons.mozilla.org/developers and choose Submit a New Add-on.
2. Choose "On your own" (unlisted, not public) and upload the Firefox zip.
3. When the automatic check passes, download the signed `.xpi`.
4. In Firefox: `about:addons`, gear icon, Install Add-on From File, pick the `.xpi`.

Raise `version` in `extension/manifest.json` before each new upload, because AMO rejects a version it has already seen.

Chromium browsers keep unpacked extensions across restarts, so load the `extension/` folder once.

## Behavior

- The timer starts when you first open a problem in that browser tab session and survives reloads.
- Switching problems updates the card. Leaving a problem page clears it.
- If the server stops receiving heartbeats for 90 seconds (tab hidden, browser closed) the card is cleared.
- Contest pages are ignored on purpose.
- Hide problem title shows "Solving a problem" plus the difficulty.
- Topics: the second line is the difficulty plus up to 3 of the problem's LeetCode tags, kept within about 30 characters so Discord does not cut the line. Core tags (Heap, Segment Tree, DP, Two Pointers, ...) come first, generic ones (Array, String, Math, ...) only fill the gap, and long names are shortened (`Heap (Priority Queue)` becomes `Heap/PQ`). The short names, the core list and the limits are constants at the top of `extension/background.js`. Turn it off with the "Show topics" toggle.
- `SHOW_BUTTON=1` adds an "Open problem" button that other people can see.

## Security

The server binds to `127.0.0.1`, rejects requests whose Host header is not localhost, and rejects any request with an Origin that is not a browser extension (`chrome-extension://`, `moz-extension://`), so a web page cannot set your presence.

## Troubleshooting

Nothing shows on Discord but the server says "Connected to Discord":

1. **Is the extension in the browser you are using?** An unpacked extension only exists in the browser you loaded it into. This one runs in Chromium browsers and Firefox-based browsers, not Safari. In Firefox it is temporary and disappears when the browser quits.
2. **Refresh the LeetCode tab** after loading or reloading the extension. Content scripts are not injected into tabs that were already open.
3. **Open the toolbar popup.** It shows whether the server is reachable, when the server last received a presence, and the extension's last update result.
4. **Watch the server terminal.** A working setup prints `Presence: 218. The Skyline Problem | Hard`. A line starting with `Rejected` names the reason.
5. **Page console** (DevTools on the problem page): `[leetcode-rpc] tracking ...` means the page was read. `metadata fetch failed` means the LeetCode lookup failed.
6. **Extension background console** (Chrome: `chrome://extensions`, click "service worker". Firefox: `about:debugging#/runtime/this-firefox`, click Inspect): `could not reach the local server` means the server is not running, the port differs, or Firefox has not granted the `127.0.0.1` permission.
7. Discord shows each app as its own "Playing" card. Another activity such as VS Code does not replace it, but check Settings > Activity Privacy.

After updating the files, restart the server and press the reload icon on the extension.

## Development

```bash
npm test          # 43 tests: server API, real extension scripts end to end (browser APIs stubbed), service and packaging helpers
npm run rpi       # progress from docs/rpi/plan.md
```

Project notes follow an RPI workflow in `docs/rpi/` (research, plan, implementation).

## Known gaps

- The LeetCode GraphQL call has not been checked against the live site from here. If the card never appears, open DevTools on the problem page and look for `[leetcode-rpc] metadata fetch failed`.
- No solved detection yet.
- The Firefox build has not been run in a real Firefox from here. Chrome-style APIs and the dual `background` keys are the parts to watch.
- Safari is not supported.
