import { Suspense } from "react";
import { connection } from "next/server";
import { requireEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { fetchRecentMessages, getAdminClient } from "@/lib/supabase";
import { Chat } from "./chat";

export default function Page() {
  return (
    <main className="mx-auto flex h-screen max-w-2xl flex-col gap-4 p-4">
      <header>
        <h1 className="text-xl font-semibold">Buzz PoC chat</h1>
        <p className="text-sm text-slate-500">
          Messages are relayed to Telegram. The feed is public in this PoC.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-slate-500">Loading messages…</p>}>
        <ChatLoader />
      </Suspense>
    </main>
  );
}

async function loadChatProps() {
  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const supabasePublishableKey = requireEnv("SUPABASE_PUBLISHABLE_KEY");
    const initialMessages = await fetchRecentMessages(getAdminClient());
    return { supabaseUrl, supabasePublishableKey, initialMessages };
  } catch (error) {
    logger.error("Failed to load chat page", { error });
    return null;
  }
}

// Request-time data (Cache Components): wait for the request, then read env and
// load the latest messages. The publishable key is handed to the browser as a
// prop, so no NEXT_PUBLIC_* variables are needed.
async function ChatLoader() {
  await connection();
  const props = await loadChatProps();
  if (!props) {
    return (
      <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
        The chat could not be loaded. Check the server configuration and logs.
      </p>
    );
  }
  return <Chat {...props} />;
}
