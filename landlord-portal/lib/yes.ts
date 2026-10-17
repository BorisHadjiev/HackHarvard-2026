// Shared YES approval used by the Photon webhook and the Spectrum iMessage inbox.
import { handleInboundYes } from "@ntk/messaging";
import { portalConfig } from "./config";

export async function approveYesPayload(payload: unknown, portalOrigin: string) {
  const cfg = portalConfig();
  const tenant = process.env.PHOTON_YES_TENANT?.trim() || "maya";
  return handleInboundYes(payload, {
    approve: async (requestId) => {
      const res = await fetch(`${cfg.tenantAppUrl}/api/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId, portal: portalOrigin, tenant }),
      });
      const body = await res.json().catch(() => ({ ok: false, code: "bad_response" }));
      return { status: res.status, body };
    },
  });
}
