# 07: Deploy on Coolify

**What to build:** The PoC running on the operator's VPS via Coolify at a public URL, configured so it's safe to expose. The deployment is two Applications from the same Git repo (web and worker, each using its own Dockerfile) plus a Coolify-managed Redis, all on the same internal network. Anyone can follow the README to deploy from scratch, including creating the Telegram bot and finding its chat id.

Context: see the spec (Implementation Decisions → Packaging and deployment, Configuration; User Stories 48, 49, 59, 60).

**Blocked by:** 06 (Production images that run anywhere).

**Status:** ready-for-human — the operator must push the repo to their own remote, enter credentials in Coolify, and perform the deploy. An agent can do the documentation and helper-script items but must not push, deploy, or handle real credentials.

- [ ] The README has a Coolify deployment section:
  - Create Redis with `maxmemory-policy noeviction` and AOF persistence.
  - Create the web Application (Dockerfile, port 3000, health check path) and the worker Application (worker Dockerfile, no port/domain).
  - Put all three on the same network and use the internal Redis URL.
  - Which env vars each service needs: web needs Supabase URL, publishable and secret keys, and Redis URL; worker needs Supabase URL, secret key, Redis URL, Telegram token and chat id.
  - None of them need to be build variables.
- [ ] The README has a Telegram setup section: create a bot with BotFather, add it to the target chat, find the chat id, and the common failure reasons (bot not in chat, privacy mode, channel admin rights).
- [ ] A helper script prints the chat ids seen by the bot (via `getUpdates`), reading the token from the local env file, without echoing the token.
- [ ] The README states clearly that the message feed is public-read in this PoC, and explains the security model: publishable key in the browser, secret key server-only, RLS, per-IP rate limit.
- [ ] The README notes that behind Cloudflare, the rate limiter uses `cf-connecting-ip`.
- [ ] Operator: the repo is pushed to their remote and connected in Coolify, both Applications and Redis are deployed, and env vars are entered.
- [ ] Operator verification on the public URL:
  - A message reaches the Telegram chat and shows completed live.
  - A bad chat id shows failed with the reason.
  - Rapid sends hit 429.
  - A worker redeploy doesn't lose or duplicate an in-flight message.
