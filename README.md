# buzz-poc

A proof of concept that relays chat messages to Telegram. You type a message in a small web chat; the app saves it to Supabase, queues it in Redis (BullMQ), and a separate worker sends it to a Telegram chat. The message's status (pending, processing, completed, failed) updates live in the UI.

Stack: Next.js (App Router) for the UI and API, Supabase Postgres + Realtime for storage, BullMQ on Redis for the queue, and a standalone Node worker that talks to the Telegram Bot API.

## Local setup

### Prerequisites

- Node 22 (the worker relies on `--env-file-if-exists`, available from 22.9)
- Docker (for a local Redis only; the database is the hosted Supabase project `buzz-poc`, there is no local Supabase stack)
- A Telegram bot token and a chat id (see "Environment variables" below)

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Copy the template and fill in the empty values. `.env.local` is git-ignored; never commit real secrets.

```bash
cp .env.example .env.local
```

| Variable | Used by | Where to get it |
| --- | --- | --- |
| `SUPABASE_URL` | web, worker | Prefilled in `.env.example` (public). |
| `SUPABASE_PUBLISHABLE_KEY` | web (also sent to the browser) | Prefilled in `.env.example` (public). |
| `SUPABASE_SECRET_KEY` | web, worker | Supabase dashboard, project `buzz-poc`, Project Settings, API Keys, the secret key (`sb_secret_...`). |
| `REDIS_URL` | web, worker | `redis://localhost:6379` for the compose Redis (prefilled). |
| `TELEGRAM_BOT_TOKEN` | worker | The token @BotFather gave you when you created the bot. |
| `TELEGRAM_CHAT_ID` | worker | Id of the chat the bot should post to. The bot must be a member of that chat and must have been sent at least one message there. |

All variables are read at runtime. The worker refuses to start and names every missing variable if any are absent.

### 3. Start Redis

```bash
docker compose up -d
```

This starts Redis only, configured with `maxmemory-policy noeviction` (queued jobs are never evicted) and AOF persistence. Data lives in the `redis-data` Docker volume. Stop it with `docker compose down` (add `-v` to also wipe the queue).

### 4. Run the app and the worker

```bash
npm run dev:all
```

This runs Next (`http://localhost:3000`) and the worker together in watch mode, with the output of both in one terminal. Next loads `.env.local` itself; the worker loads it via `tsx --env-file-if-exists`. Without `.env.local` you get a warning, and the worker logs `Worker cannot start` listing the missing variables instead of crash-looping. After creating or editing `.env.local`, restart `npm run dev:all` so the worker picks the values up.

You can also run them separately: `npm run dev` (web only) and `npm run worker:dev` (worker only, watch mode) or `npm run worker` (worker once, no watch).

### 5. Tests, types and lint

```bash
npm test          # Vitest, no network/Redis/Supabase needed
npm run typecheck
npm run lint
```

## Manual end-to-end check

The API route, the Realtime UI and the real Telegram delivery are not covered by unit tests. To verify the happy path against the real Telegram API:

1. Complete steps 1 to 4 above with all six variables set in `.env.local`.
2. Open `http://localhost:3000`, enter a display name, and send a message.
3. The message appears in the list as **pending**, then **processing**, then **completed**, without refreshing the page.
4. The same message arrives in the Telegram chat identified by `TELEGRAM_CHAT_ID`.

If the badge turns **failed** or stays on pending, check the `[worker]` output in the terminal; it logs the reason.

## Notes

- There is no rate limiter on the send endpoint yet; it arrives in ticket 04, so locally you can send as many messages as you like.
- In this PoC the message feed is public-read (anyone with the publishable key can read all messages). Do not use it for anything sensitive; a fuller security note is planned.

## Project docs

The spec and tickets live in `.scratch/telegram-relay-poc/` (start with `spec.md`).
