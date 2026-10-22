# 02c: Local dev environment and end-to-end happy path

**What to build:** One-command local development and the first real end-to-end run. Locally, a single dev command runs the web app and the worker together, against a local Redis from docker-compose and the hosted `buzz-poc` database. A newcomer can follow the README to get there. With it running, a message typed in the UI travels UI → queue → worker → Telegram, and the UI shows **completed** live. At this point the send endpoint has no rate limiter (that arrives in ticket 04), which doesn't affect the happy path.

Context: see the spec (Solution; User Story 61; Implementation Decisions → Packaging and deployment → Local development; Configuration; Testing Decisions → Not unit-tested). Production images are ticket 06; the Coolify and Telegram setup sections of the README are ticket 07.

**Blocked by:** 02a (Worker job processor — happy path), 02b (Chat page and client component — happy path UI).

**Status:** ready-for-agent

- [x] docker-compose for local development runs Redis only, with `noeviction` and AOF.
- [x] One dev command runs Next and the worker together in watch mode, loading `.env.local`.
- [x] `.env.example` lists every variable with a short comment, extending the Supabase entries added in 01.
- [x] The README has a local setup section: prerequisites, env vars, start Redis, run dev, run tests.
- [ ] Manual check: a real message sent from the UI arrives in the real Telegram chat, and the UI shows completed without a refresh.
- [x] Type check, lint and tests all pass.
