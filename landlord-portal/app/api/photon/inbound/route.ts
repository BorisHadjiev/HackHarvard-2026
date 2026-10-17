import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { handleTenantText } from "@/lib/text-reply";

function inboundSecretOk(req: Request): boolean {
  const expected = process.env.PHOTON_INBOUND_SECRET?.trim();
  if (!expected) return true;
  const got = req.headers.get("x-ntk-inbound-secret") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Photon message.received webhook. YES approves the latest request. NO declines it here.
export async function POST(req: Request) {
  if (!inboundSecretOk(req)) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  const payload = await req.json().catch(() => null);
  const result = await handleTenantText(payload, new URL(req.url).origin);

  return NextResponse.json(result.body, { status: result.status });
}
