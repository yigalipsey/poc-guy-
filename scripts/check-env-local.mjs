// Runs before `npm run dev:all`. Only checks that the file exists; it never reads it.
import { existsSync } from "node:fs";

if (!existsSync(new URL("../.env.local", import.meta.url))) {
  console.warn(
    "\n[dev:all] .env.local not found. Create it with `cp .env.example .env.local` and fill in\n" +
      "the empty values (see README). The worker will not start and the app cannot send\n" +
      "messages until it exists.\n",
  );
}
