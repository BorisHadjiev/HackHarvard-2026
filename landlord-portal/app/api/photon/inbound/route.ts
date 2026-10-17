import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { handleInboundYes } from "@ntk/messaging";
import { portalConfig } from "@/lib/config";

function inboundSecretOk(req: Request): boolean {
  const expected = process.env.PHOTON_INBOUND_SECRET?.trim();
  if (!expected) return true;
  const got = req.headers.get("x-ntk-inbound-secret") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Photon message.received webhook. YES approves the latest request texted to that phone.
export async function POST(req: Request) {
  if (!inboundSecretOk(req)) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  const payload = await req.json().catch(() => null);
  const cfg = portalConfig();
  const portal = new URL(req.url).origin;
  const tenant = process.env.PHOTON_YES_TENANT?.trim() || "maya";

  const result = await handleInboundYes(payload, {
    approve: async (requestId) => {
      const res = await fetch(`${cfg.tenantAppUrl}/api/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId, portal, tenant }),
      });
      const body = await res.json().catch(() => ({ ok: false, code: "bad_response" }));
      return { status: res.status, body };
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}
