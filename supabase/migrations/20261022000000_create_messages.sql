-- Messages relayed from the chat UI to Telegram.
-- Browsers (anon / authenticated, via the publishable key) may only read.
-- All writes go through the server and worker using the secret key (service_role).

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_name text not null
    constraint messages_user_name_length check (char_length(user_name) between 1 and 50),
  content text not null
    constraint messages_content_length check (char_length(content) between 1 and 4000),
  status text not null default 'pending'
    constraint messages_status_check check (status in ('pending', 'processing', 'completed', 'failed')),
  telegram_response text
);

create index messages_created_at_idx on public.messages (created_at desc);

-- Row level security: one public read policy, no write policies.
alter table public.messages enable row level security;

create policy "Messages are readable by everyone"
  on public.messages
  for select
  to anon, authenticated
  using (true);

-- Privileges: anon and authenticated keep SELECT only; service_role gets everything.
revoke all on table public.messages from anon, authenticated;
grant select on table public.messages to anon, authenticated;
grant all on table public.messages to service_role;

-- Realtime: broadcast row changes to subscribed browsers.
alter publication supabase_realtime add table public.messages;
