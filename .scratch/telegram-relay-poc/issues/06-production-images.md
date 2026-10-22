# 06: Production images that run anywhere

**What to build:** Two Docker images built from the repo, one for the web app and one for the worker, that run with nothing but runtime environment variables. The same images work locally and on the VPS, and building them needs no secrets. The worker behaves well under an orchestrator: it finishes the in-flight job on redeploy and warns loudly if Redis is configured in a way that could silently drop jobs.

Context: see the spec (Implementation Decisions → Packaging and deployment; Worker step 6; User Stories 41, 53–58).

**Blocked by:** 02a (Worker job processor — happy path), 02b (Chat page and client component — happy path UI).
- The manual check uses Redis from the dev docker-compose (02c).

**Status:** ready-for-agent

- [ ] Next config uses standalone output and keeps Cache Components and partial prefetching. BullMQ and ioredis are declared as server external packages.
- [ ] Web image:
  - Multi-stage on Node 22 Alpine, non-root, port 3000, binds 0.0.0.0.
  - Copies standalone output, static assets and public.
  - Docker healthcheck hits the health route.
  - Builds with no env vars set.
- [ ] Worker image:
  - The worker is bundled into a single file with esbuild for Node 22. BullMQ's optional backends (pg, redis, valkey-glide, bullmq-otel) are external.
  - Runs on Node 22 Alpine, non-root, with no HTTP server.
  - Verified that the bundle actually starts and processes a job (BullMQ Lua scripts and lazy ioredis loading work).
- [ ] `.dockerignore` excludes node_modules, build output, `.env*` (except the example), `.git` and `.scratch`.
- [ ] Graceful shutdown: on SIGTERM or SIGINT the worker stops taking new jobs, lets the in-flight job finish, closes queue and Redis connections, and exits 0.
- [ ] At startup the worker reads Redis `maxmemory-policy` and logs a loud warning unless it is `noeviction`. If `CONFIG` is disabled, it logs that the policy couldn't be verified and carries on.
- [ ] Manual check: both images run locally (docker run with env vars, Redis from the dev docker-compose), a message sent through the web container reaches Telegram, and `docker stop` on the worker mid-job lets the job complete.
- [ ] Type check, lint and tests all pass.
