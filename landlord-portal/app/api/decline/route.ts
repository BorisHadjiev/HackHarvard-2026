import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { declineRequest, readDecline } from "@/lib/decline";

// The tenant declined. Body is only { requestId, declined: true }. No claim and no financial data.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const decline = readDecline(body);
  if (!decline) return NextResponse.json({ ok: false, code: "invalid" }, { status: 400 });

  const outcome = declineRequest(store, decline.requestId);
  if (!outcome.ok && outcome.code === "unknown_request") return NextResponse.json(outcome, { status: 404 });
  if (!outcome.ok) return NextResponse.json(outcome, { status: 409 });
  return NextResponse.json({ declined: true });
}
