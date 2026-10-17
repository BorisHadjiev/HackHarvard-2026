// Inbound Photon texts. YES approves the latest request sent to that phone. NO declines it.
// The phone is kept only in this process-local map. It is not written onto the request or the claim.
import { normalizePhone } from "./photon";

const g = globalThis as unknown as { __ntkReplyIndex?: Map<string, string> };
const replyIndex: Map<string, string> = (g.__ntkReplyIndex ??= new Map());

export function rememberTenantPhone(phone: string, requestId: string): void {
  replyIndex.set(normalizePhone(phone), requestId);
}

export function requestIdForPhone(phone: string): string | undefined {
  return replyIndex.get(normalizePhone(phone));
}

export function clearReplyIndex(): void {
  replyIndex.clear();
}

function receivedMessage(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.type === "message.received" && root.data && typeof root.data === "object") {
    const object = (root.data as { object?: unknown }).object;
    if (object && typeof object === "object") return object as Record<string, unknown>;
    return null;
  }
  if (root.status === "received" && root.content && root.sentBy) return root;
  return null;
}

function textOf(content: unknown): string | null {
  if (!content || typeof content !== "object") return null;
  const c = content as { type?: unknown; text?: unknown };
  if (c.type === "text" && typeof c.text === "string") return c.text;
  return null;
}

/** Plain YES or NO, case-insensitive, with an optional trailing period or exclamation. */
function parsePlainReply(payload: unknown, word: "yes" | "no"): { phone: string } | null {
  const message = receivedMessage(payload);
  if (!message) return null;
  const sentBy = message.sentBy;
  if (!sentBy || typeof sentBy !== "object") return null;
  const from = sentBy as { handle?: unknown; kind?: unknown };
  if (from.kind === "agent") return null;
  if (typeof from.handle !== "string" || !/^[+\d\s().-]+$/.test(from.handle)) return null;
  const text = textOf(message.content);
  if (!text || !new RegExp(`^${word}[.!]?$`, "i").test(text.trim())) return null;
  try {
    return { phone: normalizePhone(from.handle) };
  } catch {
    return null;
  }
}

/** Photon `message.received` whose plain text is YES. Agent echoes are ignored. */
export function parseYesReply(payload: unknown): { phone: string } | null {
  return parsePlainReply(payload, "yes");
}

/** Photon `message.received` whose plain text is NO. Agent echoes and any other text are ignored. */
export function parseNoReply(payload: unknown): { phone: string } | null {
  return parsePlainReply(payload, "no");
}

export interface ApproveResult {
  status: number;
  body: unknown;
}

/** Drop the tenant-only income figure before anything is returned by the portal. */
export function withoutLocalFigures(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return { ok: false };
  const rest = { ...(body as Record<string, unknown>) };
  delete rest.local;
  return rest;
}

export async function handleInboundYes(
  payload: unknown,
  deps: {
    lookup?: (phone: string) => string | undefined;
    approve: (requestId: string) => Promise<ApproveResult>;
  },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const yes = parseYesReply(payload);
  if (!yes) return { status: 200, body: { ignored: true } };
  const requestId = (deps.lookup ?? requestIdForPhone)(yes.phone);
  if (!requestId) return { status: 404, body: { ok: false, code: "unknown_phone" } };
  const result = await deps.approve(requestId);
  return { status: result.status, body: withoutLocalFigures(result.body) };
}

/**
 * A NO declines the latest request texted to that phone.
 * The phone is looked up in the process-local map and is not returned or stored.
 * This does not approve and does not sign a claim.
 */
export async function handleInboundNo(
  payload: unknown,
  deps: {
    lookup?: (phone: string) => string | undefined;
    decline: (requestId: string) => Promise<ApproveResult>;
  },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const no = parseNoReply(payload);
  if (!no) return { status: 200, body: { ignored: true } };
  const requestId = (deps.lookup ?? requestIdForPhone)(no.phone);
  if (!requestId) return { status: 404, body: { ok: false, code: "unknown_phone" } };
  const result = await deps.decline(requestId);
  return { status: result.status, body: withoutLocalFigures(result.body) };
}
