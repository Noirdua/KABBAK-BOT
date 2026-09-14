# KABBAK-BOT — agent reference

Chat bot that exposes KABBAK-API over Discord and Matrix from one command core. No build step, plain CommonJS, Node 18+.

The API is a sibling checkout: `../KABBAK-API` (defaults to `http://localhost:3100/api/v1`).

## Layout

| Path | Role |
|---|---|
| `index.js` | Boot: load `.env`, start platform adapters, warm caches |
| `register-commands.js` | Register slash commands per platform |
| `lib/kabbak-api.js` | HTTP client (`apiGet`/`apiPatch`), auth headers, asset URLs, error messages |
| `lib/catalog.js` | Autocomplete values + in-memory caches for API catalogs |
| `lib/commands.js` | Command core (all behavior lives here) |
| `lib/spread-stitch.js` | Tarot spread image compositing (jimp + sharp) |
| `lib/tattva-image.js` | Tattva image rendering |
| `lib/text-command.js` | Text/library command helpers |
| `lib/user-store.js` | Per chat-user saved API keys (encrypted on disk) |
| `platforms/*` | Thin adapters (Discord, Matrix): turn `card()` results into messages |

Add new behavior to `lib/commands.js` (and friends), not to a platform adapter.

## API contract (do not break)

- Base URL: `KABBAK_API_URL` (default `http://localhost:3100/api/v1`). Shared key: `KABBAK_API_KEY`.
- Auth: `x-api-key` header. Per chat-user keys override the shared key (`lib/user-store.js`).
- Envelope: `{ data, meta }`. Unwrap with `res.data.data || res.data`.
- Errors: `{ error, message, requestId }`; `401/403` means the key is bad, `429` rate limited.

Endpoints used (keep names/shapes; see `../KABBAK-API/AGENTS.md` for the source of truth):

- `GET /health`, `GET /profile`, `PATCH /profile/location`
- `GET /now` (params `latitude`/`longitude`/`date`), `GET /calendar/week-events`
- `GET /tarot/cards` (`q`, `limit`), `GET /tarot/cards/:cardId`, `GET /tarot/cards/:cardId/image`, `GET /tarot/spreads`, `GET /tarot/spreads/:id`
- `GET /decks/options` → `{ decks: [{ id, name, label, system }] }`; `GET /decks`
- `GET /iching` → `{ hexagrams: [{ number, name }] }`, `GET /iching/hexagrams/:number`
- `GET /texts` → `{ sources: [...] }`, `GET /texts/search`, `GET /texts/:sourceId/works/:workId/sections/:sectionId`
- `GET /tattvas`, `GET /tattvas/:id`, `GET /gematria/words`, `GET /locations/*`, `GET /quiz/*`
- `GET /assets/<path>` — media tags may pass `?apiKey=` (headers elsewhere)

**Deck systems:** `GET /decks/options` items carry `system` (`tarot`, `iching`, …). Tarot-only features (spreads, tarot card image lookups) must filter out non-`tarot` decks so a hexagram deck never resolves a tarot card.

## Sync rule

The API and bot are separate repos that ship together. **When a change in `../KABBAK-API` alters a route, response shape, auth behavior, or domain feature listed above, update this bot in the same change** and note it in the commit. Keep the contract stable or bump both.

## Commands

```text
npm start            # boot the bot
npm run dev          # node --watch index.js
npm run register     # register slash commands
node --check <file>  # syntax check (no test suite)
```

## Conventions

- Keep secrets out of git: `.env` stays local (`.env.example` only has placeholders).
- `jimp` is pinned to `0.22.12` (see `spread-stitch.js` `assertJimp`); do not upgrade to 1.x.
- Matrix E2EE needs native crypto; without it set `KABBAK_MATRIX_STUB_CRYPTO=1`.
- Prefer short, user-safe error strings (see `friendlyApiError`) over raw API messages.
