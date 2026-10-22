# 02a: Worker job processor — happy path

**What to build:** The background worker that delivers a queued message to Telegram, happy path only. A separate Node process (in the currently empty `worker/` directory) takes a job from the `telegram-integration-queue`, loads the message row, marks it **processing**, posts it to the real Telegram chat as plain text `name: content`, and marks it **completed** with the Telegram result. The job processor is a plain function with injected dependencies, so it can be tested without Redis, Supabase or Telegram. This is the seam that tickets 03 and 06 build on. This ticket also lays the shared server-side foundation (env helper, logger, Supabase module, the consumer side of the queue module, Telegram client, test setup), all written from scratch, because the worker needs them and 02b builds on them.

Context: see the spec (Implementation Decisions → Modules → Worker, steps 1–3 and 6; Configuration; Testing Decisions → Seam 1). Nothing exists in `src/` yet: write the modules below from scratch, following the spec's Implementation Decisions (Environment access, Logger, Supabase module, Queue module, Telegram client) and Testing Decisions → Seam 2 as the acceptance target for the Telegram client suite. The producer side of the queue module (producer connection and `enqueueTelegramJob`) is ticket 02b. Failure handling, retries and 429s are ticket 03; graceful shutdown and the `maxmemory-policy` check are ticket 06.

**Blocked by:** 01 (Provision the buzz-poc database).

**Status:** ready-for-agent

- [ ] The worker's job processor is a function with injected dependencies (message store, Telegram sender, queue rate-limiter) and is wired to a BullMQ Worker with concurrency 1 and a limiter of 1 job per second, running as a separate Node process. This is the seam later tickets test through.
- [ ] Processor happy path: it loads the row, marks it processing, sends `name: content` via the Telegram client, records the result as job progress, then marks the row completed with the stringified Telegram result. Covered by a Vitest test through the processor seam using in-memory fakes.
- [ ] Env helper (`src/lib/env.ts`): reads a required variable at call time, never at import time, and throws a named error naming the missing variable.
- [ ] Logger (`src/lib/logger.ts`): structured JSON logger with info, warn and error, one JSON object per line.
- [ ] Supabase module (`src/lib/supabase.ts`): the admin client (secret key, refuses to construct in a browser), the browser client factory (publishable key and URL passed in, no `NEXT_PUBLIC_*`), the shared column list and page size of 50, and `fetchRecentMessages(client)` returning the latest 50, oldest first. Typed with the generated `src/types/database.ts` from 01.
- [ ] Queue module, consumer side (`src/lib/queue.ts`): the queue name `telegram-integration-queue`, the job payload type `{ messageId, content }`, the default job options (5 attempts, exponential backoff from 2s, completed jobs removed after 24h and failed after 7 days), and the worker Redis connection with `maxRetriesPerRequest: null`.
- [ ] Telegram client (`src/lib/telegram.ts`): `sendTelegramMessage`, the `TelegramError` kinds (retryable, rate_limited, fatal) and `formatTelegramText`, exactly as in the spec. Its Vitest suite covers every case listed in Testing Decisions → Seam 2.
- [ ] Test setup: `vitest.config.mts` (Node environment, `@` alias to `src`) and `test` and `typecheck` npm scripts, so the Telegram suite and the processor suite run with `npm test`.
- [ ] The worker validates its required env vars at startup and exits with a clear error if any is missing.
- [ ] Type check, lint and tests all pass.
