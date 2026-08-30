import { createHash } from "node:crypto";

import { getSessionSigningSecret } from "@/lib/session/config";

/** Short non-reversible correlation token for server logs — never log full session IDs. */
export function sessionCorrelationId(sessionId: string): string {
  return createHash("sha256")
    .update(`${sessionId}:${getSessionSigningSecret()}`)
    .digest("hex")
    .slice(0, 8);
}
