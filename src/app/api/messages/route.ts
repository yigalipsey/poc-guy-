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

  // Ticket 04 adds the per-IP rate limiter here, between validation and insert.

  const { data: message, error } = await getAdminClient()
    .from("messages")
    .insert(parsed.data)
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) {
    logger.error("Failed to insert message", { error });
    return Response.json({ error: "Failed to save message" }, { status: 500 });
  }

  // Ticket 04 handles enqueue failure (mark the row failed, return 503).
  await enqueueTelegramJob({ messageId: message.id, content: message.content });

  logger.info("Message accepted", { messageId: message.id });
  return Response.json({ message }, { status: 202 });
}
