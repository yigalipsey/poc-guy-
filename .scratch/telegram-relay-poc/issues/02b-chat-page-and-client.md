# 02b: Chat page and client component — happy path UI

**What to build:** The chat page a person uses to send messages and watch them get delivered:
1. A person opens the chat page, enters a display name (remembered in the browser) and sends a message.
2. The message appears immediately as **pending**.
3. Without refreshing, the person sees the status badge change as the row is updated, through **processing** to **completed**. Messages sent from other tabs appear live too.

This ticket also builds what the composer needs on the server: the Next app scaffold, the producer side of the queue module, the send endpoint (happy path, no rate limiting yet) and the health route. All of it is written from scratch.

Context: see the spec (Implementation Decisions → Modules → Chat page, Chat client component, Supabase module). Uses the env helper, logger, Supabase module (admin and browser clients, shared column list, `fetchRecentMessages`) and the queue module's consumer-side constants written in 02a. The scaffold files (`src/app/layout.tsx`, `globals.css`, favicon) and the page, client component, send endpoint, health route and queue producer are written from scratch here, following the spec's Implementation Decisions (Queue module, Messages API route, Health route, API contract). `npm run build` fails until this ticket adds the scaffold. This Next.js version has breaking changes: read the relevant guide in `node_modules/next/dist/docs/` (Cache Components, `connection()`, Suspense) before writing code, and heed deprecation notices. Reconnect refetch, monotonic merge, the connection indicator and changing the name are ticket 05; inline error handling in the composer is ticket 04. Rate limiting, the full status-code table and queue-outage handling on the endpoint are ticket 04, so the route here works without the rate limiter and 04 adds it. The full UI → Telegram run is verified in 02c.

**Blocked by:** 01 (Provision the buzz-poc database), 02a (Worker job processor — happy path).
- 02a provides the env helper, logger, Supabase module, queue constants and test setup that this ticket builds on, so 02a goes first. 01 provides the generated database types.

**Status:** ready-for-agent

- [x] Next app scaffold: `src/app/layout.tsx`, `src/app/globals.css` (Tailwind) and a favicon, so `npm run dev` and `npm run build` succeed with no env vars set.
- [x] Queue module, producer side (added to `src/lib/queue.ts`): a producer Redis connection cached on `globalThis` so dev hot reloads don't leak connections, and `enqueueTelegramJob(data)` adding the job with `jobId = messageId`. Fail-fast connection settings and the 3-second give-up are ticket 04.
- [x] Send endpoint `POST /api/messages` happy path: parses JSON, validates with Zod (`user_name` trimmed 1–50 characters, `content` trimmed 1–4000), inserts the row with the admin client, enqueues, and returns 202 `{ message }`. It has no rate limiter yet. The status-code mapping for failures is ticket 04.
- [x] Health route `GET /api/health` returns 200 `{ ok: true }` at request time and does not check Redis or Supabase.
- [x] The chat page renders its shell immediately and loads the latest 50 messages at request time (Next 16 Cache Components: request-time data behind `connection()` inside Suspense).
- [x] The Supabase URL and publishable key are passed to the client as props. No `NEXT_PUBLIC_*` vars and no secret key reach the browser.
- [x] Name gate: the display name is entered once and stored in localStorage (wrapped in try/catch), and is pre-filled on reload.
- [x] Composer: Enter sends and Shift+Enter adds a newline. The Send button disables while a request is in flight. The 202 response row appears in the list immediately.
- [x] The client subscribes to Supabase Realtime INSERT and UPDATE on messages. Status badges (pending grey, processing blue with a spinner, completed green, failed red) update live, and messages from other tabs appear live.
- [x] Messages are shown oldest to newest, with the list scrolled to the newest.
- [x] Type check, lint and tests all pass.
