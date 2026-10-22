Status: ready-for-agent

# Spec: Buzz-style Telegram relay PoC

## Problem Statement

I want to demonstrate a secure, privacy-first messaging and integration platform (inspired by Buzz). A person types a message into a web chat, and that message must reliably reach an external system (a Telegram chat) without the person waiting on, or being affected by, the external system's latency, outages or rate limits.

Today there is nothing: no way to send a message, no durable record of it, no background delivery, and no visibility into whether a delivery succeeded, is still in flight, or failed. If the external API is slow, rate-limits us, or rejects the request, a naive synchronous implementation would hang the UI, lose messages, or post duplicates.

The PoC runs on my own VPS via Coolify, so it must be deployable as ordinary containers. It must also be safe to expose on a public URL: no secrets in the browser, and no way for a stranger to flood my Telegram chat.

## Solution

A small web app where a person picks a display name and sends chat messages. Each message is:

1. saved immediately with status **pending**, and the UI confirms right away (non-blocking);
2. handed to a background **queue**;
3. picked up by a separate **worker** process that makes a real call to the Telegram Bot API;
4. moved through **pending → processing → completed | failed**, with the Telegram result (or the final error) recorded on the message.

The chat UI shows every message with a live status badge that updates in real time as the worker progresses, with no page refresh. Transient failures (network, timeouts, Telegram 5xx) are retried with exponential backoff. Telegram rate limits (429) pause delivery for exactly the time Telegram asks for. Permanent errors (bad token, bad chat id, bot blocked) fail immediately with a clear reason. A message is never posted to Telegram twice.

Stack: Next.js (App Router, TypeScript, Tailwind) for UI and API; Supabase Postgres for storage and Realtime; BullMQ on Redis for the queue. Deployed as two Coolify applications from one repo (web + worker) plus a Coolify-managed Redis. The database is a dedicated hosted Supabase project (`buzz-poc`, region eu-central-1).

## User Stories

### Sending messages

1. As a chat user, I want to enter a display name once, so that I don't have to type it with every message.
2. As a chat user, I want my display name remembered in this browser, so that I'm not asked again when I reload the page.
3. As a chat user, I want to change my display name, so that I can correct a typo or switch identity.
4. As a chat user, I want to type a message and send it with Enter or a Send button, so that sending feels like a normal chat app.
5. As a chat user, I want the message to appear in the list immediately after sending, so that I know it was accepted.
6. As a chat user, I want sending to return instantly even if Telegram is slow, so that the UI never hangs.
7. As a chat user, I want empty or whitespace-only messages rejected, so that I don't send blanks by accident.
8. As a chat user, I want a clear error if my message is over the length limit, so that I know to shorten it.
9. As a chat user, I want a clear error if my name is missing or too long, so that I can fix it.
10. As a chat user, I want the Send button disabled while a send request is in flight, so that I don't double-submit.
11. As a chat user, I want my draft kept if sending fails, so that I don't lose what I typed.

### Seeing delivery status

12. As a chat user, I want each message to show a status badge (pending, processing, completed, failed), so that I know where it is in the pipeline.
13. As a chat user, I want status badges to update live without refreshing, so that I can watch delivery happen.
14. As a chat user, I want to see the reason when a message fails, so that I understand what went wrong.
15. As a chat user, I want completed messages to show they were delivered to Telegram, so that I trust the integration.
16. As a chat user, I want messages from other people to appear live too, so that it behaves like a shared chat room.
17. As a chat user, I want the most recent messages loaded when I open the page, so that I have context.
18. As a chat user, I want messages ordered oldest to newest with the newest at the bottom, so that it reads like a conversation.
19. As a chat user, I want the list to scroll to the newest message, so that I don't have to scroll manually.
20. As a chat user, I want to see whether the live connection is up, so that I know whether statuses are current.
21. As a chat user, I want the list to catch up on anything I missed after a reconnect, so that statuses are never stuck on stale values.
22. As a chat user, I want a status never to go backwards in the UI (e.g. completed reverting to pending because events arrived out of order), so that what I see is trustworthy.

### Errors visible to the user

23. As a chat user, I want a friendly message when I'm sending too fast (rate limited), including how long to wait, so that I know when I can send again.
24. As a chat user, I want a clear message when the queue is unavailable, so that I know the problem is temporary and on the server side.
25. As a chat user, I want a message whose queueing failed to show as failed rather than pending forever, so that the UI is honest.

### Background delivery

26. As the operator, I want delivery to Telegram to happen in a separate worker process, so that web requests stay fast and the worker can be scaled or restarted independently.
27. As the operator, I want each message delivered as plain text in the form "name: content", so that there is no HTML/Markdown injection and no escaping bugs.
28. As the operator, I want network errors and timeouts retried with exponential backoff, so that transient blips don't lose messages.
29. As the operator, I want Telegram 5xx responses retried with backoff, so that Telegram-side outages self-heal.
30. As the operator, I want Telegram 429 responses to pause delivery for exactly the `retry_after` Telegram specifies, so that we respect flood control instead of hammering the API.
31. As the operator, I want a 429 pause to apply to the whole queue, not just one job, so that other messages don't immediately hit the same limit.
32. As the operator, I want a 429 pause not to use up one of the message's retry attempts, so that rate limiting alone never causes a failure.
33. As the operator, I want permanent errors (400 bad request/chat not found, 401 bad token, 403 bot blocked, 404) to fail immediately without retries, so that we don't waste attempts on errors that will never succeed.
34. As the operator, I want a message marked failed, with the last error recorded, once retries are exhausted, so that nothing stays "processing" forever.
35. As the operator, I want the worker to send at most about one message per second, so that we stay within Telegram's per-chat limits.
36. As the operator, I want a message never posted to Telegram twice, even if a job is retried after Telegram already accepted it, so that the chat doesn't get duplicates (apart from the accepted at-least-once residual risk under Further Notes).
37. As the operator, I want the same message never enqueued twice, so that duplicate jobs can't exist.
38. As the operator, I want the worker to skip a job whose message is already completed, so that redelivered jobs are harmless.
39. As the operator, I want a job for a message that no longer exists to fail permanently, so that it doesn't retry forever.
40. As the operator, I want the Telegram result stored on the message when delivery succeeds, so that I can audit what was sent.
41. As the operator, I want a redeploy (SIGTERM) to let the in-flight job finish before the worker exits, so that deploys don't interrupt deliveries.
42. As the operator, I want finished jobs cleaned up automatically (completed after 24h, failed after 7 days), so that Redis doesn't grow unbounded.

### Security and privacy

43. As the operator, I want the browser to hold only the publishable (read-only) Supabase key, so that a visitor can never write to or tamper with the database directly.
44. As the operator, I want all writes to go through the server using the secret key, so that validation and rate limits can't be bypassed.
45. As the operator, I want Row Level Security on the messages table that allows public read only, so that the database enforces the policy even if the app has a bug.
46. As the operator, I want the Telegram bot token never logged, returned in errors, or sent to the browser, so that it can't leak.
47. As the operator, I want a per-IP rate limit on the send endpoint (10 per minute), so that a stranger who finds the URL can't flood my Telegram chat.
48. As the operator, I want the client IP taken correctly from behind Coolify's Traefik proxy (and Cloudflare, if used), so that rate limiting targets real clients and can't be trivially spoofed.
49. As the operator, I want it clearly documented that the message feed is public in this PoC, so that nobody mistakes it for a private channel.

### Integration API

50. As an integrator, I want to send a message with a plain HTTP POST (JSON body with name and content), so that other services and curl can use the platform, not just the UI.
51. As an integrator, I want a 202 Accepted response containing the stored message, so that I get its id and initial status back.
52. As an integrator, I want 400 for invalid input, 429 with a Retry-After header for rate limiting, and 503 when the queue is unavailable, so that I can handle each case programmatically.

### Operations and deployment

53. As the operator, I want the web app and the worker built as two separate Docker images from one repo, so that Coolify can deploy and restart them independently.
54. As the operator, I want the web image to read all configuration at runtime, not bake it in at build time, so that one image works in any environment and Coolify doesn't need build variables.
55. As the operator, I want a health endpoint on the web app, so that Coolify can monitor it.
56. As the operator, I want the worker to fail fast at startup when required configuration is missing, so that misconfiguration is obvious immediately.
57. As the operator, I want the worker to warn loudly if Redis isn't configured with `maxmemory-policy noeviction`, so that queued jobs aren't silently evicted.
58. As the operator, I want structured JSON logs from the API and worker (job id, message id, attempt, error kind), so that I can debug from Coolify's log view.
59. As the operator, I want setup instructions for Supabase, Coolify (web, worker, Redis networking and config), and creating a Telegram bot and finding its chat id, so that I can deploy from scratch.
60. As the operator, I want a helper script that prints chat ids seen by my bot, so that finding the chat id is painless.
61. As a developer, I want one command to run the web app and the worker together locally, with Redis from a local docker-compose and the hosted Supabase project as the database, so that local development is quick.
62. As a developer, I want the database schema stored as a versioned migration in the repo, so that the schema is reproducible and reviewable.
63. As a developer, I want TypeScript types generated from the live database schema, so that queries are type-checked.

## Implementation Decisions

### Modules

- **Environment access**: a tiny helper that reads a required env var at call time (never at import time) and throws a named error if it's missing. Needed so builds don't require secrets and one image works everywhere.
- **Logger**: structured JSON logger (info/warn/error), one JSON object per line. Never receives secrets.
- **Supabase module**: owns the typed clients and message read helpers.
  - Admin client: secret key, server and worker only, refuses to construct in a browser.
  - Browser client: publishable key, created from URL and key passed from the server at request time (not `NEXT_PUBLIC_*`).
  - Shared column list and page size (50) so server and browser queries match.
  - `fetchRecentMessages(client)` returns the latest 50, oldest first.
- **Queue module**: owns the queue name `telegram-integration-queue`, the job payload type, default job options, Redis connections and the enqueue function.
  - Job payload: `{ messageId, content }` (as specified). The worker reads the user name from the database row.
  - Default job options: 5 attempts; exponential backoff starting at 2s (2/4/8/16s); remove completed jobs after 24h and failed jobs after 7 days.
  - Worker connection: `maxRetriesPerRequest: null`, as BullMQ requires.
  - Producer connection: fail-fast (offline queue disabled, short connect timeout), so an HTTP request can return 503 quickly when Redis is down. Cached on `globalThis` so dev hot reloads don't leak connections.
  - `enqueueTelegramJob(data)`: adds the job with `jobId = messageId` (idempotent enqueue) and gives up after 3s.
- **Telegram client**: BullMQ-agnostic deep module.
  - `sendTelegramMessage({ token, chatId, text, timeoutMs?, fetchImpl? })` posts JSON `{ chat_id, text }` to `sendMessage` with a 10s timeout and returns Telegram's `result`.
  - On any failure it throws a `TelegramError` with `kind`, optional `status` and optional `retryAfterMs`:
    - `retryable`: network errors, timeouts, any 5xx, including non-JSON 5xx bodies.
    - `rate_limited`: 429, with `retryAfterMs` taken from `parameters.retry_after`, defaulting to 5s if absent.
    - `fatal`: every other non-OK response.
  - Error messages never contain the request URL, which embeds the token.
  - `formatTelegramText(userName, content)` returns `"<userName>: <content>"`. No `parse_mode` is sent.
- **Rate limiter**: fixed-window per-IP counter in Redis (INCR + EXPIRE), 10 requests per 60s, which also returns seconds until the window resets. Throws if Redis is unreachable; the caller maps that to 503.
  - `getClientIp(headers)` prefers `cf-connecting-ip`, then the right-most `x-forwarded-for` entry (Traefik overwrites the header for untrusted clients), then `x-real-ip`.
- **Messages API route** (producer), `POST /api/messages`, in this order:
  1. Parse JSON; on failure return 400.
  2. Validate with Zod: `user_name` trimmed, 1–50 characters; `content` trimmed, 1–4000 characters (Telegram allows 4096; this leaves room for the name prefix). On failure return 400 with the first issue's message.
  3. Rate-limit by IP: over the limit returns 429 with `Retry-After`; limiter unreachable returns 503.
  4. Insert the row with the admin client (status defaults to `pending`); on failure return 500.
  5. Enqueue. On failure, update that row to `failed` with `telegram_response = "Queue unavailable: <reason>"` and return 503 with the updated row.
  6. Return 202 `{ message }`.
- **Health route**, `GET /api/health`: returns `{ ok: true }` at request time. It deliberately doesn't check Redis or Supabase, so a dependency blip doesn't make Coolify restart the web app.
- **Worker** (separate Node process): a BullMQ Worker on the queue with concurrency 1 and a limiter of 1 job per 1000 ms. The job processor is the main seam (see Testing):
  1. Load the message row (id, status, user_name).
     - Read error: rethrow as retryable.
     - Row missing: unrecoverable.
     - Status `completed`: return without sending (idempotent redelivery).
  2. If the job's progress already holds a Telegram result (the "sent once" marker from an earlier attempt), skip sending. Otherwise:
     - Set status to `processing` (never overwriting `completed`).
     - Send via the Telegram client.
     - On success, store `{ telegramResult }` as job progress before touching the database.
  3. Update the row to `completed` with `telegram_response` set to the stringified Telegram result. A failed update rethrows, so the retry only redoes this step and never re-sends.
  4. Error mapping:
     - `fatal` → BullMQ `UnrecoverableError`.
     - `rate_limited` → rate-limit the whole queue for `retryAfterMs`, then throw BullMQ's rate-limit error. The job returns to waiting and doesn't use an attempt.
     - `retryable` → rethrow, so BullMQ applies exponential backoff.
  5. Final-failure marking happens in the processor, not in a `failed` event handler, so it's deterministic. If the error is unrecoverable, or this was the last attempt (`attemptsMade + 1 >= attempts`), set the row to `failed` with the error message (never overwriting `completed`), then rethrow. Rate-limit errors never mark failed.
  6. Startup and shutdown:
     - Required env vars are validated on startup.
     - Check `CONFIG GET maxmemory-policy` and warn loudly if it isn't `noeviction`, tolerating `CONFIG` being disabled.
     - On SIGTERM/SIGINT, call `worker.close()` so the in-flight job finishes, close the queue, quit Redis, then exit 0.
  7. Worker `error` events are logged. Retries are logged with attempt number and error kind.
- **Chat page**:
  - The static shell renders immediately. A Suspense-wrapped server loader waits for the request (`connection()`, as required by Next 16 Cache Components), reads Supabase URL and publishable key from env, loads the recent messages with the admin client, and renders the client chat component with those as props.
- **Chat client component**:
  - Name gate stored in localStorage, with every access wrapped in try/catch.
  - Message list keyed by id, sorted by `created_at`.
  - Subscribes to Supabase Realtime `postgres_changes` (INSERT and UPDATE) on `public.messages`.
  - On every successful (re)subscribe, refetches the recent messages with the browser client and merges them, which closes the gap between server render and subscription.
  - Merging is monotonic by status rank (pending 0, processing 1, completed or failed 2), so a late event or POST response never moves a status backwards.
  - Composer: Enter sends, Shift+Enter adds a newline. It disables while sending, keeps the draft on error, and shows 400/429/503 errors inline. The POST response row is merged immediately.
  - Status badges: pending grey, processing blue with a spinner, completed green, failed red with the error. A connection indicator shows Realtime state.

### Schema (single migration)

- Table `public.messages`:

  | Column | Type | Constraints |
  | --- | --- | --- |
  | `id` | uuid | primary key, default `gen_random_uuid()` |
  | `created_at` | timestamptz | not null, default `now()` |
  | `user_name` | text | not null, 1–50 characters |
  | `content` | text | not null, 1–4000 characters |
  | `status` | text | not null, default `'pending'`, CHECK in (`pending`, `processing`, `completed`, `failed`) |
  | `telegram_response` | text | nullable: stringified Telegram result on success, final error message on failure |

- Index on `created_at desc`.
- RLS enabled with a single SELECT policy for `anon` and `authenticated` using `true`. Write privileges are revoked from `anon` and `authenticated`, which keep SELECT only. `service_role` gets all privileges.
- The table is added to the `supabase_realtime` publication.
- No columns beyond those in the original brief.

### API contract

- `POST /api/messages`, body `{ "user_name": string, "content": string }`:

  | Status | Body / headers |
  | --- | --- |
  | 202 | `{ message: MessageRow }` |
  | 400 | `{ error }` |
  | 429 | `{ error }` plus `Retry-After` |
  | 503 | `{ error, message? }` (`message` is the row now marked failed, when one was created) |
  | 500 | `{ error }` |

- `GET /api/health` → 200 `{ ok: true }`.

### Configuration (all read at runtime)

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`): given to the browser via props.
- `SUPABASE_SECRET_KEY` (`sb_secret_…`): server and worker only.
- `REDIS_URL`: Coolify-internal Redis URL.
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`: worker only, set in Coolify by the operator.
- New Supabase API keys are used, not the legacy anon/service_role keys.

### Packaging and deployment

- **Web**:
  - Next `output: "standalone"`, keeping `cacheComponents` and `partialPrefetching`.
  - BullMQ and ioredis are declared as server external packages so Next doesn't bundle them.
  - Multi-stage Node 22 Alpine image that runs as non-root, exposes 3000, binds 0.0.0.0, and has a Docker healthcheck on the health route.
  - No env vars are needed at build time.
- **Worker**:
  - Bundled into one CommonJS file with esbuild for Node 22. BullMQ's optional backends (pg, redis, valkey-glide, bullmq-otel) are marked external.
  - Runs on Node 22 Alpine as non-root, with no HTTP server; Coolify restarts it if it exits.
  - Must be verified to actually start from the bundle (BullMQ's Lua scripts and lazy ioredis loading).
- **Coolify**:
  - Two Applications from the same Git repo, each pointing at its own Dockerfile, plus Coolify's Redis.
  - All three on the same internal network.
  - Redis set to `maxmemory-policy noeviction` with AOF persistence.
- **Local development**:
  - docker-compose runs Redis only, already set to `noeviction` with AOF.
  - One dev command runs Next and the worker together (watch mode), loading `.env.local` and pointing at the hosted `buzz-poc` database. No local Supabase stack.
- **Supabase**:
  - Dedicated project `buzz-poc` in eu-central-1 on the free org. One existing project must be paused first, because of the 2-active-project free limit.
  - The migration lives in the repo and is also applied to the hosted project. Types are generated from the live schema, and the security advisor runs afterwards.
- **Git**: the repo is initialised and committed locally only. The operator pushes it to their own remote and connects it in Coolify.

### Library versions (current at time of writing)

- Next 16.4 with React 19.3; Cache Components on by default, so request-time data must sit behind `connection()` inside Suspense.
- BullMQ 6.4 with a pluggable backend. It still accepts an ioredis instance as `connection`. Use `queue.rateLimit()`; `worker.rateLimit()` is deprecated.
- ioredis 6 (use the named `Redis` export), supabase-js 2.118, Zod 4, Vitest 5, tsx, esbuild, concurrently.

## Testing Decisions

- **What makes a good test:** it exercises behavior through a module's public interface and asserts observable outcomes (returned values, thrown error kinds, state transitions recorded through injected collaborators). It doesn't assert internal call order or private helpers. Tests must be fast and deterministic, with no real network, Redis or Supabase.
- **Seam 1: the worker job processor (primary).** Extract the processor as a function that takes the job plus injected dependencies: a message store (read row, mark processing, mark completed, mark failed), a Telegram sender, and a queue rate-limiter. Tests drive it with fake jobs (data, progress, attemptsMade, attempts) and in-memory fakes, and assert:
  - Happy path: pending → processing → completed, with the Telegram result stored.
  - An already-completed row is skipped without sending.
  - An existing "sent once" progress marker means no re-send; only completion is retried.
  - A failed completion update after a successful send rethrows, and the next attempt doesn't re-send.
  - A `fatal` error is unrecoverable and marks the row failed immediately.
  - A `retryable` error on a non-final attempt rethrows without marking failed.
  - A `retryable` error on the final attempt marks the row failed with the error message.
  - `rate_limited` calls the queue rate-limiter with `retryAfterMs`, throws the rate-limit signal, and never marks failed.
  - A missing row is unrecoverable.
  - Marking failed never overwrites a completed row.
- **Seam 2: the Telegram client.** Tested through `sendTelegramMessage` with an injected `fetch`. Covers:
  - Success returns `result` and sends the correct URL, method and body.
  - 429 is `rate_limited` and honors `retry_after`, with a 5s default.
  - 5xx, including a non-JSON body, is `retryable`.
  - 400, 401, 403 and 404 are `fatal` and include Telegram's description.
  - Network failure is `retryable`, and the token never appears in the error message.
  - Timeout is `retryable`.
  - Text formatting is plain `name: content`.
- **Not unit-tested (manual end-to-end):** the API route, the Realtime UI, Docker images and Coolify wiring. They are verified by running locally against the real Telegram API: send a message and watch it go pending → processing → completed in the UI and arrive in Telegram. Then repeat with a bad chat id (expect immediate failed) and with Redis stopped (expect 503 and failed).
- **Prior art:** none in the repo. Write the Telegram client suite first (Vitest, Node environment, `@` alias to `src`, injected `fetch`) and follow the same pattern for the processor suite.
- Test runner: Vitest. Type checking and lint run alongside.

## Out of Scope

- User accounts, authentication or per-user privacy. The feed is public-read in this PoC, and this is documented.
- End-to-end encryption or any message confidentiality beyond TLS and server-only secrets.
- Multiple Telegram chats or bots, routing rules, or integrations other than Telegram.
- Inbound Telegram messages (webhooks or `getUpdates`-driven replies into the chat). The only `getUpdates` use is the chat-id helper script.
- A manual "retry failed message" button, editing or deleting messages, pagination beyond the latest 50, typing indicators and read receipts.
- Queue dashboards (Bull Board) or metrics or alerting beyond structured logs.
- An outbox table or sweeper for rows whose enqueue failed: they are marked failed instead.
- Formatted messages (HTML/Markdown `parse_mode`), attachments and media.
- Horizontal scaling of the worker (concurrency is 1 by design, for Telegram limits).
- Local Supabase stack, Upstash, Vercel, or any non-Coolify deployment target.
- Creating or pushing to a Git remote.
- Captcha or bot detection on the send endpoint (per-IP rate limiting only).

## Further Notes

- **Key decisions:** the deployment target is Coolify Redis on the operator's VPS (not Upstash), and the status lifecycle includes `processing` and `failed`.
- **Starting point:** everything is written from scratch following this spec.
  - Present: the Next project config (`package.json` with dependencies, `next.config.ts`, `tsconfig.json`, eslint config), `node_modules`, and these planning docs.
  - To write: migration and generated types (ticket 01); env, logger, Supabase module, queue consumer side, Telegram client and its tests, test setup and the worker with its processor seam (02a); app scaffold, queue producer, send endpoint happy path, health route, chat page and client (02b); docker-compose, dev command and `.env.example` completion (02c); rate limiter, `getClientIp` and the endpoint's failure handling (04); Dockerfiles and Next config changes (06); README sections and chat-id helper script (07, with the local setup section in 02c).
  - `npm run build` fails until the app scaffold exists (02b).
- **Supabase project:** the dedicated `buzz-poc` Supabase project exists (ref `sfyaiqceptuzdgxvpksh`); ticket 01 verifies it is the dedicated project before anything is applied.
- **Credentials:** Telegram credentials are entered by the operator in Coolify and `.env.local`; never read, echo or commit them.
- **At-least-once residual risk:** if Telegram accepts a message but saving the "sent once" progress marker to Redis fails in that same instant, a retry could re-send. This narrow window is accepted for the PoC.
- **429 ceiling:** a 429 rate-limit pause relies on BullMQ's worker maximum rate-limit delay (30s default) to re-check. Long `retry_after` values still apply because the queue-level rate-limit key holds until it expires.
