// Tenant declined a request. Owner: Boris (UI flow).
// The shared status union has no "declined" value, so this stores "rejected".
// That means the tenant declined. It is not a failed signature check.
// Nothing financial is written: no result, no nonce use, no account or device id.
import type { Store } from "./store";

export type DeclineOutcome =
  | { ok: true }
  | { ok: false; code: "unknown_request" | "already_answered" };

/** Accept only `{ requestId, declined: true }`. Any other field is refused. */
export function readDecline(body: unknown): { requestId: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !keys.includes("requestId") || !keys.includes("declined")) return null;
  if (record.declined !== true || typeof record.requestId !== "string" || record.requestId.length === 0) return null;
  return { requestId: record.requestId };
}

export function declineRequest(store: Store, requestId: string): DeclineOutcome {
  const request = store.requests.get(requestId);
  if (!request) return { ok: false, code: "unknown_request" };
  if (request.status === "verified") return { ok: false, code: "already_answered" };
  if (request.status !== "rejected") {
    request.status = "rejected";
    store.save(); // in-place edit; the map does not notice it
  }
  return { ok: true };
}
