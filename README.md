# KABBAK Bot

Chat bot that exposes KABBAK-API features. Discord and Matrix are live adapters; Telegram can share the same command core later.

Command logic, KABBAK API calls, saved keys, and location live in `lib/`. Each chat network is a thin adapter under `platforms/` that turns those results into native messages.

## Features / Command syntax

Everything lives under the single global `/kabbak` command.

### Your API key

Each chat-account can save their own KABBAK API key. After that, every command runs as their account (profile, location, access). The key is collected privately, never posted in the room, and stored encrypted on disk. Users are namespaced (`discord:…`, `matrix:…`, later `telegram:…`) so platforms do not collide.

- `/kabbak api login` — collect the key privately (Discord: modal; Matrix: private unencrypted chat, then the key is redacted)
- `/kabbak api status` — check the saved key (private reply)
- `/kabbak api logout` — remove it

Without a saved key, commands use the shared bot key from `.env`.

### Tarot
- `/kabbak tarot draw [spread:three-card] [deck]` — one image with cards and meanings (default upright). `reversed:true` to allow reversed cards. `stitch:false` or `separate` for one message per card
- `/kabbak tarot card name:The Empress [deck]` — look up one card (meanings, dates, one image)
- `/kabbak tarot cards [query:fool] [deck]` — list/search the card library
- `/kabbak tarot spreads` — list available spreads

### Time & location
- `/kabbak now [country] [region] [city]` — current astrological snapshot (lat/lon still work)
- `/kabbak calendar [country] [region] [city]` — week events
- `/kabbak location view` — show your saved location
- `/kabbak location set country:us region:us-ca city:us-ca-los-angeles` — save a place (autocomplete; lat/lon still work)
- `/kabbak location clear` — remove it

### Library
- `/kabbak iching [number:24]` — I-Ching hexagram (random when omitted)
- `/kabbak tattva [tattva:akasha]` — Golden Dawn tattva (lists the five primaries when omitted)
- `/kabbak gematria value:111` — reverse gematria lookup
- `/kabbak quiz [category]` — quiz question with tappable answers
- `/kabbak search query:rose cross [source] [work]` — full-verse text search; optional source/work autocomplete to narrow the library
- `/kabbak text sources` — list the library's books
- `/kabbak text section source:… work:… section:… [verse:3-6]` — read verses (max 3; omit verse for a random one). Source/work/section/verse autocomplete; type to search past the first 25 Discord shows.

### System
- `/kabbak decks` — available tarot decks
- `/kabbak status` — API health and which key you are using
- `/kabbak help` — everything above with descriptions

### Location resolution for now and calendar
1. Explicit `latitude`/`longitude` options, otherwise
2. this chat account's saved location, otherwise
3. the KABBAK profile location (only if they logged in with their own API key), otherwise
4. the built-in default (Sydney).

## Setup

A fresh clone has no secrets and no runtime state. Copy the example env, fill in your own values, then `npm install`. `.env` and `storage/` are gitignored (sessions, saved keys, Matrix login).

1. Copy env:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` (leave unused platforms blank):
    - `DISCORD_TOKEN` / `DISCORD_CLIENT_ID` — Discord bot token and application ID (optional if you only run Matrix)
    - Matrix: see **Matrix login** below
    - `KABBAK_API_URL` = http://.../api/v1
    - `KABBAK_API_KEY=` (bot reader client; used when a user has no saved key)
    - `KABBAK_KEY_ENCRYPTION_SECRET` — set this before running Discord and Matrix together so rotating one chat token does not invalidate saved keys

3. Make sure KABBAK-API is running.

4. Register Discord slash commands (run once or after changes; skip if Discord is unset):
    ```bash
    npm run register
    ```

5. Start bot:
    ```bash
    npm start
    ```

Discord and Matrix can run in the same process. Either platform is enough to start.

## Inviting the Discord bot
- In Discord Dev Portal > OAuth2 > URL Generator
- Scopes: `bot` + `applications.commands`
- Bot Permissions: Send Messages, Embed Links

## Matrix login

The bot logs into a normal Matrix account (there is no separate “bot type”). Use a dedicated account, not your personal one.

### 1. Create the bot account

On your own Synapse:

```bash
register_new_matrix_user -c /path/to/homeserver.yaml https://matrix.example.org
```

Or register in Element on that homeserver. You need:

- Homeserver URL, e.g. `https://matrix.example.org`
- User ID, e.g. `@kabbak:example.org`
- Password, **or** an access token

`MATRIX_URL` / `MATRIX_USERNAME` (from the older MatrixBot env) are accepted as aliases.

### 2. Put credentials in `.env`

**Password (first run):**

```env
MATRIX_HOMESERVER=https://matrix.example.org
MATRIX_USER_ID=@kabbak:example.org
MATRIX_PASSWORD=the-bot-password
KABBAK_KEY_ENCRYPTION_SECRET=a-long-random-string
```

Start the bot. It logs in, writes `storage/matrix/session.json` (gitignored), then you can remove `MATRIX_PASSWORD` from `.env`.

**Access token (recommended after that):**

In Element, sign in as the bot → Settings → Help & About → Access Token.

```env
MATRIX_HOMESERVER=https://matrix.example.org
MATRIX_USER_ID=@kabbak:example.org
MATRIX_ACCESS_TOKEN=syt_...
```

An env token wins over `session.json`. Do not commit `.env` or `storage/`.

### 3. Run it

```bash
npm install
npm start
```

You should see `[matrix] ready as @kabbak:example.org on https://matrix.example.org`.

Invite the bot to an **unencrypted** room (encrypted rooms are not readable yet). Then:

```
!kabbak help
!kabbak now Los Angeles
!kabbak tarot draw
!kabbak card empress
!kabbak api login
```

`MATRIX_PREFIX` overrides the default `!kabbak` (`/kabbak` still works). Use plain names; quotes and IDs are optional. `!kabbak now Los Angeles` and `!kabbak now location:Los Angeles` both work.

**API login:** run `!kabbak api login` in an unencrypted room. The bot opens a private unencrypted chat, you paste the key there, and it redacts that message. If someone DMs the bot first, Element often encrypts that DM and the bot cannot read it — start from an unencrypted room instead.

### 4. Encryption secret when Discord is already live

If users already saved Discord API keys, set `KABBAK_KEY_ENCRYPTION_SECRET` to the **current** value used to encrypt them (today that is `DISCORD_TOKEN` unless you already set the secret) **before** the first Matrix start. Changing the secret later makes old saved keys unreadable.

## Adding Telegram later

Do not put network SDK calls in `lib/`. Add `platforms/telegram.js` that exports `start()`, then enable it from `index.js` when `TELEGRAM_BOT_TOKEN` is set.

Each adapter should:

1. Map the native user to `accountId('telegram', id)` from `lib/user-store`.
2. Parse the incoming command into `{ group, subcommand, args }` and call `dispatch()` from `lib/commands`.
3. Render returned **cards** (title, description, fields, imageUrl, buttons).
4. For `type: 'collect-secret'` (API login), collect the key in a DM or private form — never echo it in a public room — then call `completeApiLogin(userId, key)`.
5. For quiz buttons, parse `quiz:<id>:<index>` and call `answerQuiz(id, index, actorLabel)`.
6. Reuse `lib/catalog.suggest()` for autocomplete / inline suggestions.

## Notes
- Saved user keys live in `storage/users.json`, encrypted at rest. `storage/` is gitignored.
- Card images still use the bot key in the public asset URL so personal keys are never leaked to a CDN/image proxy.
- Run only one Discord bot instance per token.
- After changing slash commands, run `npm run register`.
