"use client";
// Browser side of the chat: name gate, live message list (Supabase Realtime) and the
// composer that POSTs to /api/messages. Status changes arrive via Realtime, not the POST.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { mergeMessages } from "@/lib/merge-messages";
import { CONTENT_MAX, USER_NAME_MAX } from "@/lib/send-message";
import { createBrowserClient, type MessageRow } from "@/lib/supabase";

const NAME_STORAGE_KEY = "buzz-poc:user-name";

// Display name, remembered in localStorage. Every access is wrapped in
// try/catch (private mode or blocked storage must not break the page).
// `undefined` = not read yet (server render), `null` = no name stored.
// The "storage" event doesn't fire in the tab that wrote the value, so changes are
// announced to useSyncExternalStore through this listener set instead.
const nameListeners = new Set<() => void>();

function readStoredName(): string | null {
  try {
    return window.localStorage.getItem(NAME_STORAGE_KEY);
  } catch {
    return null;
  }
}

let fallbackName: string | null = null; // used when storage is unavailable

function getNameSnapshot(): string | null {
  return readStoredName() ?? fallbackName;
}

function saveName(name: string): void {
  fallbackName = name;
  try {
    window.localStorage.setItem(NAME_STORAGE_KEY, name);
  } catch {
    // keep the in-memory name only
  }
  nameListeners.forEach((listener) => listener());
}

function subscribeToName(listener: () => void): () => void {
  nameListeners.add(listener);
  return () => nameListeners.delete(listener);
}

function useStoredName(): [string | null | undefined, (name: string) => void] {
  // The server snapshot (undefined) matches the server render, so reading localStorage
  // after hydration doesn't cause a mismatch.
  const name = useSyncExternalStore<string | null | undefined>(
    subscribeToName,
    getNameSnapshot,
    () => undefined,
  );
  return [name, saveName];
}

type Props = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  initialMessages: MessageRow[];
};

export function Chat({ supabaseUrl, supabasePublishableKey, initialMessages }: Props) {
  const [userName, setUserName] = useStoredName();
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages);

  // Initial rows come from the server render; everything after goes through
  // mergeMessages so the list stays keyed by id and sorted.
  const merge = (incoming: MessageRow[]) =>
    setMessages((current) => mergeMessages(current, incoming));

  const supabase = useMemo(
    () => createBrowserClient(supabaseUrl, supabasePublishableKey),
    [supabaseUrl, supabasePublishableKey],
  );

  // Live updates: INSERT brings new messages (including other people's), UPDATE
  // carries the worker's status changes. The table must be in the
  // supabase_realtime publication, and RLS lets the publishable key read it. Rows
  // created while this is not subscribed are not refetched on (re)connect.
  useEffect(() => {
    const onChange = (payload: RealtimePostgresChangesPayload<MessageRow>) => {
      if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
        setMessages((current) => mergeMessages(current, [payload.new]));
      }
    };
    const channel = supabase
      .channel("messages")
      .on<MessageRow>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        onChange,
      )
      .on<MessageRow>(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        onChange,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase]);

  // Hooks above must all run before these early returns to keep hook order stable.
  if (userName === undefined) {
    return null; // storage not read yet; avoids flashing the name gate
  }
  if (userName === null) {
    return <NameGate onSubmit={setUserName} />;
  }

  return (
    <>
      <p className="text-sm text-slate-500">
        Chatting as <span className="font-medium text-slate-900">{userName}</span>
      </p>
      <MessageList messages={messages} />
      <Composer userName={userName} onSent={(message) => merge([message])} />
    </>
  );
}

function NameGate({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (trimmed) onSubmit(trimmed);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <label htmlFor="user-name" className="text-sm font-medium">
        Choose a display name
      </label>
      <input
        id="user-name"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={USER_NAME_MAX}
        autoFocus
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        placeholder="Your name"
      />
      <button
        type="submit"
        disabled={!trimmed}
        className="self-start rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Continue
      </button>
    </form>
  );
}

function MessageList({ messages }: { messages: MessageRow[] }) {
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the newest message in view whenever one is added. Keyed on length so a
  // status update to an existing row doesn't scroll the list.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  return (
    <ul
      ref={listRef}
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3"
    >
      {messages.length === 0 && (
        <li className="m-auto text-sm text-slate-400">No messages yet.</li>
      )}
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
    </ul>
  );
}

function MessageItem({ message }: { message: MessageRow }) {
  return (
    <li className="rounded-md bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
        <span className="font-medium text-slate-900">{message.user_name}</span>
        {/* Server and browser may format the time in different time zones. */}
        <time dateTime={message.created_at} suppressHydrationWarning>
          {new Date(message.created_at).toLocaleTimeString()}
        </time>
      </div>
      <p className="mt-1 break-words whitespace-pre-wrap text-sm">{message.content}</p>
      <div className="mt-2">
        <StatusBadge message={message} />
      </div>
    </li>
  );
}

// status is a plain text column, so BADGE_STYLES is keyed by string and unknown
// values fall back to the pending style below.
const BADGE_STYLES: Record<string, string> = {
  pending: "bg-slate-200 text-slate-700",
  processing: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

function StatusBadge({ message }: { message: MessageRow }) {
  const { status } = message;
  return (
    <div className="flex flex-col gap-1">
      <span
        className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_STYLES[status] ?? BADGE_STYLES.pending}`}
      >
        {status === "processing" && (
          <span
            aria-hidden
            className="size-3 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700"
          />
        )}
        {status}
      </span>
      {status === "failed" && message.telegram_response && (
        <span className="text-xs break-words text-red-700">
          {message.telegram_response}
        </span>
      )}
    </div>
  );
}

function Composer({
  userName,
  onSent,
}: {
  userName: string;
  onSent: (message: MessageRow) => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not just `sending`: state updates are async, so a quick double Enter could
  // otherwise pass the check twice and submit the message twice.
  const inFlight = useRef(false);

  async function send() {
    const content = draft.trim();
    if (!content || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: userName, content }),
      });
      const body = (await response.json().catch(() => null)) as {
        message?: MessageRow;
        error?: string;
      } | null;
      // Merge the POST response right away so the message shows up without waiting for
      // the Realtime INSERT event; the draft is cleared only on success.
      if (response.ok && body?.message) {
        onSent(body.message);
        setDraft("");
      } else {
        setError(body?.error ?? `Sending failed (${response.status})`);
      }
    } catch {
      setError("Could not reach the server. Your draft is kept.");
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: Enter confirms an IME candidate and must not send the message.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void send();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          // Mirrors the server-side limit; the API still validates independently.
          maxLength={CONTENT_MAX}
          rows={2}
          placeholder="Type a message. Enter to send, Shift+Enter for a new line."
          aria-label="Message"
          className="min-h-12 flex-1 resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={sending || draft.trim() === ""}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}
