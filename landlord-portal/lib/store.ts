import type { VerificationRequest } from "@ntk/shared";

// In-memory store, kept on globalThis so it survives Next.js hot reloads.
// TODO(Sam): swap for a JSON file or SQLite so requests survive a server restart.
type Store = { requests: Map<string, VerificationRequest>; usedNonces: Set<string> };

const g = globalThis as unknown as { __ntkStore?: Store };
export const store: Store = (g.__ntkStore ??= { requests: new Map(), usedNonces: new Set() });

/** What the tenant app is allowed to see about a request. */
export function publicView(r: VerificationRequest) {
  const { id, nonce, requesterName, audience, question, expiresAt, status } = r;
  return { id, nonce, requesterName, audience, question, expiresAt, status };
}
