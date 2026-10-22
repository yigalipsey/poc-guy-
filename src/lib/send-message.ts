import { z } from "zod";

export const USER_NAME_MAX = 50;
export const CONTENT_MAX = 4000;

export const sendMessageSchema = z.object({
  user_name: z
    .string("Name is required")
    .trim()
    .min(1, "Name is required")
    .max(USER_NAME_MAX, `Name must be at most ${USER_NAME_MAX} characters`),
  content: z
    .string("Message is required")
    .trim()
    .min(1, "Message is required")
    .max(CONTENT_MAX, `Message must be at most ${CONTENT_MAX} characters`),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export type ParsedSendMessage =
  | { ok: true; data: SendMessageInput }
  | { ok: false; error: string };

// Validates a parsed JSON body; the error is the first issue's message.
export function parseSendMessage(body: unknown): ParsedSendMessage {
  const result = sendMessageSchema.safeParse(body);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? "Invalid request" };
  }
  return { ok: true, data: result.data };
}
