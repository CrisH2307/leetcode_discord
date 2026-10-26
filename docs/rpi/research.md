# Research

Goal: show the LeetCode problem I am working on as a Discord "Playing" card.

Target layout:

```
Playing
LeetCode                  <- Discord application name
1. Two Sum                <- details
Medium                    <- state
00:12:41                  <- startTimestamp (elapsed timer)
```

## Prior art (searched 2026-10-26)

- No dedicated LeetCode Rich Presence extension found.
- Generic browser presence tools exist: Browser Discord Status (archived 2022), Brave-rpc, Discord-RPC-Extension by lolamtisch (open API, no presences of its own, needs its desktop app).
- LeetCode Discord bots exist (random question, completion tracker). They are server bots and cannot set a personal status.
- Not verified: whether the supported-sites lists of the generic tools include LeetCode.
- No earlier work of mine on this.

## Constraints

- Discord Rich Presence is set by a local process talking to the desktop client over IPC. A bot or a web page cannot do it.
- The activity title ("LeetCode") is the Discord application name. RPC cannot change it.
- details and state must be 2 to 128 characters.
- Discord rate limits presence updates (about 5 per 20 seconds), so resend only on change.
- A Chrome extension content script is subject to page CORS, so the localhost call must come from the background service worker.
- Any web page can try to POST to localhost, so the server must check Host and Origin.

## Data source

- Problem URL: `https://leetcode.com/problems/<slug>/`
- Metadata: LeetCode GraphQL `question(titleSlug)` with `questionFrontendId`, `title`, `difficulty`.
- Contest URLs (`/contest/.../problems/...`) do not match `^/problems/` and are ignored on purpose.
- LeetCode is a single page app, so URL changes must be polled, not read once.

## Decisions

1. Own stack (Chrome MV3 extension + small Node server) instead of lolamtisch's RPC extension: more control, fewer moving parts to depend on.
2. Server stays dumb: validates a small schema and adds assets. Extension composes the text.
3. Privacy: hide-title toggle, contest pages ignored, presence cleared on timeout.
4. Not in v1: solved detection, Firefox, leetcode.cn.
