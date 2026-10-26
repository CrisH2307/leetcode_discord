# LeetCode Discord Presence

Shows the problem you are working on as your Discord activity:

```
Playing
LeetCode
1. Two Sum
Medium
00:12:41
```

Two parts:

- `extension/`: Chrome extension (MV3). Reads the problem from the page and sends it to the local server.
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

1. Open `chrome://extensions` and turn on Developer mode.
2. Click Load unpacked and select the `extension/` folder.
3. Open any `https://leetcode.com/problems/...` page.

The toolbar popup has two toggles (show on Discord, hide problem title) and shows whether the server and Discord are connected.

## Behavior

- The timer starts when you first open a problem in that browser tab session and survives reloads.
- Switching problems updates the card. Leaving a problem page clears it.
- If the server stops receiving heartbeats for 90 seconds (tab hidden, browser closed) the card is cleared.
- Contest pages are ignored on purpose.
- Hide problem title shows "Solving a problem" plus the difficulty.
- `SHOW_BUTTON=1` adds an "Open problem" button that other people can see.

## Security

The server binds to `127.0.0.1`, rejects requests whose Host header is not localhost, and rejects any request with an Origin that is not a browser extension, so a web page cannot set your presence.

## Troubleshooting

Nothing shows on Discord but the server says "Connected to Discord":

1. **Is the extension in the browser you are using?** An unpacked extension only exists in the browser you loaded it into, and only Chromium browsers (Chrome, Edge, Brave, Arc) accept this one. Safari, Firefox and some smaller browsers will not run it.
2. **Refresh the LeetCode tab** after loading or reloading the extension. Content scripts are not injected into tabs that were already open.
3. **Open the toolbar popup.** It shows whether the server is reachable, when the server last received a presence, and the extension's last update result.
4. **Watch the server terminal.** A working setup prints `Presence: 218. The Skyline Problem | Hard`. A line starting with `Rejected` names the reason.
5. **Page console** (DevTools on the problem page): `[leetcode-rpc] tracking ...` means the page was read. `metadata fetch failed` means the LeetCode lookup failed.
6. **Extension service worker console** (`chrome://extensions`, click "service worker"): `could not reach the local server` means the server is not running or the port differs.
7. Discord shows each app as its own "Playing" card. Another activity such as VS Code does not replace it, but check Settings > Activity Privacy.

After updating the files, restart the server and press the reload icon on the extension.

## Development

```bash
npm test          # 21 tests: server API plus the real extension scripts end to end (browser APIs stubbed)
npm run rpi       # progress from docs/rpi/plan.md
```

Project notes follow an RPI workflow in `docs/rpi/` (research, plan, implementation).

## Known gaps

- The LeetCode GraphQL call has not been checked against the live site from here. If the card never appears, open DevTools on the problem page and look for `[leetcode-rpc] metadata fetch failed`.
- No solved detection yet.
- Chrome only.
# leetcode_discord
