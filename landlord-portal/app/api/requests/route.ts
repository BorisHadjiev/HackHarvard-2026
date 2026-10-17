import { NextResponse } from "next/server";
import { randomUUID, randomBytes } from "node:crypto";
import { MIN_AGE, type Question, type VerificationRequest } from "@ntk/shared";
import { store } from "@/lib/store";
import { portalConfig } from "@/lib/config";
import { notifyTenant } from "@/lib/notify";
import { portalPublicOrigin } from "@/lib/public-url";
import { tenantVerificationLink } from "@/lib/tenant-link";
import { rememberTenantPhone } from "@ntk/messaging";

const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The question and the one-line text summary for it. Income stays the default. */
function questionFrom(body: Record<string, unknown>, requesterName: string): { question: Question; summary: string } | { error: string } {
  if (body.type === "age_over") {
    return { question: { type: "age_over", min_age: MIN_AGE }, summary: `${requesterName} asks: are you at least ${MIN_AGE}?` };
  }
  if (body.type !== undefined && body.type !== "income_to_rent") return { error: `unknown question type: ${String(body.type)}` };
  const rent = Number(body.rent);
  const multiple = Number(body.multiple ?? 3);
  if (!Number.isFinite(rent) || rent <= 0 || !Number.isFinite(multiple) || multiple <= 0) {
    return { error: "rent and multiple must be positive numbers" };
  }
  const question: Question = { type: "income_to_rent", rent: Math.round(rent), multiple };
  return { question, summary: `${requesterName} asks: is your income at least ${multiple}x $${question.rent.toLocaleString("en-US")} rent?` };
}

// Create a verification request: { rent, multiple, tenantPhone? } or { type: "age_over", tenantPhone? }
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const cfg = portalConfig();
  const q = questionFrom(body, cfg.requesterName);
  if ("error" in q) return NextResponse.json({ error: q.error }, { status: 400 });

  const now = new Date();
  const request: VerificationRequest = {
    id: randomUUID(),
    nonce: randomBytes(16).toString("base64url"),
    requesterName: cfg.requesterName,
    audience: cfg.audience,
    question: q.question,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + REQUEST_TTL_MS).toISOString(),
    status: "pending",
  };
  store.requests.set(request.id, request);

  const portalUrl = portalPublicOrigin(req);
  const link = tenantVerificationLink(cfg.tenantAppUrl, request.id, portalUrl);
  const summary = q.summary;
  if (typeof body.tenantPhone === "string" && body.tenantPhone.trim()) {
    try {
      rememberTenantPhone(body.tenantPhone, request.id);
    } catch {
      // An unusable phone still leaves the link on screen.
    }
  }
  const delivery = await notifyTenant(typeof body.tenantPhone === "string" ? body.tenantPhone : undefined, link, summary);

  return NextResponse.json({ request, link, delivery }, { status: 201 });
}

export async function GET() {
  const all = [...store.requests.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ requests: all });
}
