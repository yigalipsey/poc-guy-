# 01: Provision the buzz-poc database

**What to build:** A live, dedicated Supabase project that the app can talk to. The messages table exists with the agreed schema, RLS and Realtime, so that a browser holding only the publishable key can read messages and receive live changes but can never write. The repo holds the versioned migration that created it, and its database types are generated from the real schema.

Context: see the spec, `.scratch/telegram-relay-poc/spec.md` (Implementation Decisions → Schema; Configuration; Further Notes → Supabase project). No application code exists yet: this ticket writes the migration SQL and the generated types from scratch, following the spec's Schema section. The shared env, logger, Supabase and queue modules are created in 02a.

**Blocked by:** None (can start immediately).
- The Supabase project already exists, so nothing needs to be created: URL `https://sfyaiqceptuzdgxvpksh.supabase.co`, project ref `sfyaiqceptuzdgxvpksh`. Before changing anything, verify it is the intended dedicated project (named `buzz-poc`, or clearly fresh with no unrelated tables or data). If it holds unrelated tables or data, stop and tell the operator.
- Env var names follow the spec's Configuration section: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (not `NEXT_PUBLIC_*`).

**Status:** ready-for-agent

- [x] The existing project `sfyaiqceptuzdgxvpksh` is verified to be the intended dedicated `buzz-poc` project (name, region eu-central-1, no unrelated tables or data) in the operator's org.
- [x] A single versioned migration in `supabase/migrations/` implements the spec's Schema section (table, constraints, `created_at desc` index, RLS and grants, Realtime publication). It is applied to the project exactly as committed, and the project's migration history shows it.
- [x] `public.messages` has exactly these columns: id, created_at, user_name, content, status (default pending), telegram_response.
- [x] The status CHECK allows only pending, processing, completed and failed, and the length CHECKs are in place.
- [x] RLS is enabled with only a public SELECT policy, and the table is in the `supabase_realtime` publication.
- [x] Verified behavior with the anon/publishable role: SELECT succeeds; INSERT, UPDATE and DELETE are rejected.
- [x] `src/types/database.ts` is generated from the live schema, and the project type-checks. (`npx tsc --noEmit` passes; `npm run build` still fails until the app scaffold exists in 02b, as expected.)
- [x] The security advisor reports no issues for `public.messages`, or any finding is documented with its remediation link.
- [x] The project URL and publishable key are recorded in a tracked `.env.example` as placeholders or comments (`.gitignore` already un-ignores it). Ticket 02c completes the file with every other variable.
- [x] The operator is told where to get the secret key. Never print or commit secret keys.

## Comments

- 2026-10-22, agent: Verified project `sfyaiqceptuzdgxvpksh` via the logged-in Supabase CLI: name `buzz-poc`, eu-central-1, ACTIVE_HEALTHY, no tables in `public` and no migration history before this ticket.
- Applied `supabase/migrations/20261022000000_create_messages.sql` unchanged with `supabase db push` (run from a scratch workdir holding a byte-identical copy, so no CLI link files land in the repo). `supabase_migrations.schema_migrations` shows `20261022000000 create_messages`.
- Catalog checks: the 6 columns and defaults match the spec; CHECKs `messages_user_name_length` (1–50), `messages_content_length` (1–4000) and `messages_status_check` exist; index `messages_created_at_idx (created_at DESC)`; RLS enabled; the only policy is a permissive SELECT for `{anon,authenticated}` using `true`; grants are anon/authenticated SELECT only and service_role all; the table is in `supabase_realtime`.
- Behavior as `anon` in a rolled-back SQL block: SELECT ok; INSERT, UPDATE and DELETE fail with 42501. CHECK violations fail with 23514. Publishable-key REST: GET 200 `[]`; POST, PATCH and DELETE return 401 with 42501 "permission denied for table messages". The table is still empty.
- Security advisor: no issues. The performance advisor reports only INFO `unused_index` on `messages_created_at_idx` (expected on an empty, new table; https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
- Secret key: Supabase dashboard → Project Settings → API Keys → secret key (`sb_secret_…`). Put it only in `.env.local` / Coolify as `SUPABASE_SECRET_KEY`.
