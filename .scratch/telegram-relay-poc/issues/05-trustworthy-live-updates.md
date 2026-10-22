# 05: Trustworthy live updates

**What to build:** The chat list can always be trusted to show current statuses:
- The person sees whether the live connection is up.
- After a dropped connection or a sleeping laptop, the list catches up on everything missed.
- A status never moves backwards, even when events arrive out of order. For example, a late POST response saying pending must not overwrite completed.
- The person can change their display name.

Context: see the spec (User Stories 3, 20–22; Implementation Decisions → Chat client component, monotonic merge by status rank).

**Blocked by:** 02b (Chat page and client component — happy path UI).
- The manual check needs the worker running locally to complete the message, so it assumes 02a and 02c.

**Status:** ready-for-agent

- [ ] A connection indicator shows the Realtime subscription state (connecting, live, disconnected).
- [ ] On every successful (re)subscribe, the client refetches the latest 50 messages with the browser (publishable-key) client and merges them into the list.
- [ ] Merging is keyed by message id and monotonic by status rank (pending 0, processing 1, completed or failed 2). A lower-ranked update never replaces a higher-ranked one, and equal rank takes the newer data.
- [ ] Live events, the POST response and refetches all go through the same merge.
- [ ] The display name can be changed from the chat view, and the new name is remembered in the browser.
- [ ] Manual check: send a message, kill network or Realtime briefly while the worker completes it, restore. The badge ends up completed without a page reload.
- [ ] Type check, lint and tests all pass.
