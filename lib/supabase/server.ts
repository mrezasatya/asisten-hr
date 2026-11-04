import "server-only";
import { createAdminClient } from "./admin";

// Re-export for server code inside the Next.js app (API routes, server components).
// The `server-only` import makes the build fail if this is ever imported by client code.
export const getServerSupabase = createAdminClient;
