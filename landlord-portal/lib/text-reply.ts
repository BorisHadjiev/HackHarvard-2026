// Routes an inbound tenant text. YES still approves. NO declines in this portal only.
// The phone stays in the process-local reply index and is never written onto the request.
import { handleInboundNo, parseNoReply, parseYesReply } from "@ntk/messaging";
import { declineRequest } from "./decline";
import { store, type Store } from "./store";
import { approveYesPayload } from "./yes";

type TextResult = { status: number; body: Record<string, unknown> };

/** Record a NO against the latest request for that phone. No claim and no /api/approve. */
export function declineRememberedRequest(target: Store, payload: unknown): Promise<TextResult> {
  return handleInboundNo(payload, {
    decline: async (requestId) => {
      const outcome = declineRequest(target, requestId);
      if (!outcome.ok && outcome.code === "unknown_request") return { status: 404, body: outcome };
      if (!outcome.ok) return { status: 409, body: outcome };
      return { status: 200, body: { declined: true } };
    },
  });
}

export async function handleTenantText(
  payload: unknown,
  portalOrigin: string,
  deps: {
    approve?: (payload: unknown, portalOrigin: string) => Promise<TextResult>;
    decline?: (payload: unknown) => Promise<TextResult>;
  } = {},
): Promise<TextResult> {
  if (parseYesReply(payload)) return (deps.approve ?? approveYesPayload)(payload, portalOrigin);
  if (parseNoReply(payload)) return (deps.decline ?? ((body) => declineRememberedRequest(store, body)))(payload);
  return { status: 200, body: { ignored: true } };
}
