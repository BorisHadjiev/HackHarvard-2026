import { NextResponse } from "next/server";
import { signClaim, type VerificationRequest } from "@ntk/shared";
import { tenantConfig } from "@/lib/config";
import { checkIntegrity } from "@/lib/integrity";
import { fetchDeposits, DEMO_TENANTS, type DemoTenant } from "@/lib/nessie";
import { evaluateIncome } from "@/lib/income";
import { buildClaimPayload } from "@/lib/claim";

// The tenant approved. Everything sensitive happens here, on the tenant's machine:
// tamper check -> fetch deposits -> compute -> sign yes/no -> send only the signed answer.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const cfg = tenantConfig();
  const portal = String(body.portal || cfg.defaultPortalUrl);
  const tenant = (body.tenant in DEMO_TENANTS ? body.tenant : "maya") as DemoTenant;

  const integrity = await checkIntegrity();
  if (!integrity.passed) {
    return NextResponse.json({ ok: false, code: "tampered", message: integrity.reason ?? "App integrity check failed; refusing to sign" }, { status: 403 });
  }

  const reqRes = await fetch(`${portal}/api/requests/${encodeURIComponent(String(body.requestId))}`, { cache: "no-store" });
  if (!reqRes.ok) return NextResponse.json({ ok: false, code: "unknown_request" }, { status: 404 });
  const { request } = (await reqRes.json()) as { request: VerificationRequest };

  const { deposits, source } = await fetchDeposits(tenant);
  const income = evaluateIncome(deposits, request.question.rent, request.question.multiple);

  const payload = await buildClaimPayload(request, { id: tenant, secret: cfg.tenantSecret }, income, integrity);
  const token = await signClaim(payload, cfg.privateJwk);

  const verdict = await fetch(`${portal}/api/claims`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: request.id, token }),
  });
  const portalReply = await verdict.json();

  // Shown on the tenant's own screen only (it never left this machine).
  return NextResponse.json({ ...portalReply, local: { dataSource: source, medianMonthlyIncome: income.medianMonthlyIncome } }, { status: verdict.status });
}
