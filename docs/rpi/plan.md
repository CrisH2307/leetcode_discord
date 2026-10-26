# Plan

Progress is read by `node scripts/rpi-status.mjs`.

## Server (`server/`)

- [x] `discord.js`: connect, reconnect every 10s, dry-run mode, set and clear activity
- [x] `app.js`: HTTP API (`GET /health`, `POST /presence`, `POST /clear`), Host and Origin checks, body limit, dedupe, TTL sweep
- [x] `index.js`: config from env or `.env`, start
- [x] Tests with `node --test` using a fake presence backend

## Extension (`extension/`)

- [x] `manifest.json` (MV3, host permissions for localhost and leetcode.com)
- [x] `content.js`: slug from URL, GraphQL metadata, per-problem start time, 1s URL polling, heartbeat, clear on leave
- [x] `background.js`: settings, compose text, forward to server, re-apply on setting change
- [x] `popup.html` and `popup.js`: enabled toggle, hide-title toggle, server status

## Verification

- [x] Server tests pass (API and full chain with stubbed browser APIs)
- [x] Syntax check on all extension scripts
- [ ] Load the extension in the user's browser (Firefox-based) and open a problem (needs the user's machine)
- [ ] Confirm the card in Discord with the real Application ID and art asset (needs the user's machine)
- [ ] Confirm the LeetCode GraphQL response shape on the live site

## Later

- [ ] Detect "Accepted" and show a solved state
- [ ] Optional streak or daily count
- [ ] Firefox build
