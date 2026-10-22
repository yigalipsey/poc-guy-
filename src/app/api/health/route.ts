// Liveness probe for the container healthcheck / Coolify.
import { connection } from "next/server";

// Evaluated per request. Deliberately checks neither Redis nor Supabase, so a
// dependency blip doesn't make the platform restart the web app.
export async function GET() {
  await connection();
  return Response.json({ ok: true });
}
