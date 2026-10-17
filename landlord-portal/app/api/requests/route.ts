import { NextResponse } from "next/server";
import { randomUUID, randomBytes } from "node:crypto";
import type { VerificationRequest } from "@ntk/shared";
import { store } from "@/lib/store";
import { portalConfig } from "@/lib/config";
import { notifyTenant } from "@/lib/notify";

const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Create a verification request: { rent, multiple, tenantPhone? }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const rent = Number(body.rent);
  const multiple = Number(body.multiple ?? 3);
  if (!Number.isFinite(rent) || rent <= 0 || !Number.isFinite(multiple) || multiple <= 0) {
    return NextResponse.json({ error: "rent and multiple must be positive numbers" }, { status: 400 });
  }

  const cfg = portalConfig();
  const now = new Date();
  const request: VerificationRequest = {
    id: randomUUID(),
    nonce: randomBytes(16).toString("base64url"),
    requesterName: cfg.requesterName,
    audience: cfg.audience,
    question: { type: "income_to_rent", rent: Math.round(rent), multiple },
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + REQUEST_TTL_MS).toISOString(),
    status: "pending",
  };
  store.requests.set(request.id, request);

  const portalUrl = new URL(req.url).origin;
  const link = `${cfg.tenantAppUrl}/request/${request.id}?portal=${encodeURIComponent(portalUrl)}`;
  const summary = `${request.requesterName} asks: is your income at least ${multiple}x $${request.question.rent.toLocaleString("en-US")} rent?`;
  const delivery = await notifyTenant(body.tenantPhone, link, summary);

  return NextResponse.json({ request, link, delivery }, { status: 201 });
}

export async function GET() {
  const all = [...store.requests.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ requests: all });
}
