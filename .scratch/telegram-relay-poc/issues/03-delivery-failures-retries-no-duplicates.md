# 03: Delivery failures — retries, rate limits, no duplicates

**What to build:** When Telegram misbehaves, the person sees an honest status and a retry never re-sends a message Telegram already accepted (except the accepted at-least-once window in the spec: the send succeeds but saving the progress marker to Redis fails in that same instant):
- **Permanent error** (bad token, unknown chat id, bot blocked): the message turns **failed** right away, with the reason visible in the UI.
- **Transient error** (network, timeout, 5xx): the message stays **processing** while it is retried with exponential backoff (2/4/8/16s, 5 attempts). It ends **completed**, or **failed** with the last error once attempts run out.
- **Telegram 429:** the whole queue pauses for exactly Telegram's `retry_after`, then continues. Rate limiting alone never fails a message.
- **Retried job:** a message already completed is never re-sent. If the send succeeded but saving the result failed, the retry only saves.

Context: see the spec (Implementation Decisions → Worker, steps 1–5; Testing Decisions → Seam 1). The Telegram client (written in 02a) classifies errors into retryable, rate_limited and fatal. This ticket maps those kinds onto BullMQ behavior inside the processor.

**Blocked by:** 02a (Worker job processor — happy path).
- The manual check sends from the UI on the local setup, so it also needs 02b and 02c in place.

**Status:** ready-for-agent

- [ ] Fatal Telegram errors become BullMQ unrecoverable errors, and the row is marked failed with the error message on the first attempt.
- [ ] Retryable errors are rethrown so BullMQ applies the configured exponential backoff. The row stays processing on non-final attempts.
- [ ] On the final attempt (or any unrecoverable error), the processor itself marks the row failed with the error message before rethrowing. Marking happens in the processor, not a `failed` event handler.
- [ ] Marking failed never overwrites a completed row, and marking processing never overwrites a completed row.
- [ ] `rate_limited` errors rate-limit the whole queue for `retryAfterMs` and throw BullMQ's rate-limit signal. They never mark failed and don't use up an attempt.
- [ ] A job whose row is already completed returns without sending.
- [ ] A job whose progress already holds a Telegram result ("sent once" marker) skips sending and only retries completing the row.
- [ ] A job whose row doesn't exist fails as unrecoverable.
- [ ] A database read error while loading the row is retryable.
- [ ] Each retry is logged with job id, message id, attempt number and error kind. The bot token never appears in logs or stored errors.
- [ ] Vitest coverage through the processor seam for every case above: happy path, already completed, sent-once marker, failed completion update then retry without re-send, fatal, retryable non-final, retryable final, rate_limited, missing row, never overwriting completed.
- [ ] Manual check: with a wrong chat id, a message from the UI shows failed with Telegram's reason within seconds.
- [ ] Type check, lint and tests all pass.
