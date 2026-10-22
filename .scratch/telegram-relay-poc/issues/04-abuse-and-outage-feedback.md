# 04: Abuse & outage feedback in the composer

**What to build:** When the send endpoint refuses a message, the person understands why and loses nothing:
- **Sending too fast** (over 10 per minute from one IP): the composer shows a friendly "try again in Ns" message.
- **Queue down** (Redis unreachable): the composer explains it's a temporary server problem. Any message that was saved but couldn't be queued shows as **failed** with "Queue unavailable", never stuck on pending.
- **Invalid input** (empty, too long, missing name): the composer shows the specific reason.
- **Every error:** the typed draft stays in the composer, and integrators calling the API directly get clean status codes.

Context: see the spec (User Stories 7–11, 23–25, 47–48, 50–52; Implementation Decisions → Rate limiter, Messages API route, API contract). The send endpoint's happy path, the queue producer and the health route come from 02b. This ticket writes the rate limiter from scratch, completes the endpoint's failure handling, and builds the UI side.

**Blocked by:** 02b (Chat page and client component — happy path UI).
- The manual checks run against the local setup from 02c (Redis from docker-compose, the one dev command).

**Status:** ready-for-agent

- [ ] Rate limiter (`src/lib/rate-limit.ts`): a fixed-window per-IP counter in Redis (INCR + EXPIRE), 10 requests per 60 seconds, returning the seconds until the window resets, and throwing if Redis is unreachable. It is added to the endpoint between validation and insert.
- [ ] Status codes from the API route:

  | Situation | Response |
  | --- | --- |
  | Invalid JSON | 400 |
  | Validation failure | 400 with the first issue's message |
  | Over the rate limit | 429 with a `Retry-After` header |
  | Rate limiter or queue unreachable | 503 |
  | Insert failure | 500 |
  | Success | 202 with the stored row |

- [ ] If enqueueing fails after the insert, the row is updated to failed with `telegram_response` starting "Queue unavailable", and the 503 body includes that row.
- [ ] The producer connection is fail-fast (offline queue disabled, short connect timeout) and the enqueue gives up within about 3 seconds when Redis doesn't respond. The request never hangs.
- [ ] `getClientIp(headers)` returns `cf-connecting-ip` if present, else the right-most `x-forwarded-for` entry, else `x-real-ip`. The limiter keys on it.
- [ ] Composer: 400, 429 and 503 errors are shown inline and the draft is kept. The 429 message includes the wait time. A failed row returned with a 503 appears in the list as failed.
- [ ] The UI rejects empty or whitespace-only messages before sending.
- [ ] Manual check with curl: 11 rapid POSTs give ten 202s and one 429 with `Retry-After`.
- [ ] Manual check with Redis stopped: sending from the UI shows the queue-unavailable error inline, nothing is stuck pending, and the request returns within a few seconds.
- [ ] Type check, lint and tests all pass.
