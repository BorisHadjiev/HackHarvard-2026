import { NextResponse } from "next/server";
import { tenantConfig } from "@/lib/config";

// Forwards a decline. The portal receives only the request id and declined: true.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const cfg = tenantConfig();
  const portal = String(body.portal || cfg.defaultPortalUrl);
  const requestId = String(body.requestId ?? "");
  if (!requestId) return NextResponse.json({ ok: false, code: "invalid" }, { status: 400 });

  const verdict = await fetch(`${portal}/api/decline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId, declined: true }),
  });
  const reply = await verdict.json().catch(() => ({ ok: false, code: "unreadable" }));
  return NextResponse.json(reply, { status: verdict.status });
}
