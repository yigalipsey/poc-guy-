// Producer side of the relay: POST /api/messages validates, saves the message as
// pending and queues it. Delivery to Telegram happens later in the worker process.
import { logger } from "@/lib/logger";
import { enqueueTelegramJob } from "@/lib/queue";
import { parseSendMessage } from "@/lib/send-message";
import { MESSAGE_COLUMNS, getAdminClient } from "@/lib/supabase";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const parsed = parseSendMessage(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  // No per-IP rate limiting yet: anyone who can reach this endpoint can queue messages
  // as fast as they like.

  // Insert before enqueueing so the worker (which loads the row by id) and the live
  // UI always have a row. Only validated fields are written; status defaults to
  // 'pending' in the database, so clients can't choose it.
  const { data: message, error } = await getAdminClient()
    .from("messages")
    .insert(parsed.data)
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) {
    logger.error("Failed to insert message", { error });
    return Response.json({ error: "Failed to save message" }, { status: 500 });
  }

  // If this throws (e.g. Redis down) nothing catches it: the row stays 'pending' and
  // the request ends in a generic 500.
  await enqueueTelegramJob({ messageId: message.id, content: message.content });

  logger.info("Message accepted", { messageId: message.id });
  // 202, not 201: the message is stored and queued but not delivered yet.
  return Response.json({ message }, { status: 202 });
}
