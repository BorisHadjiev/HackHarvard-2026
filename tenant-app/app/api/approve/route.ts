import { NextResponse } from "next/server";
import { signClaim, type ClaimPayload, type VerificationRequest } from "@ntk/shared";
import { tenantConfig } from "@/lib/config";
import { checkIntegrity } from "@/lib/integrity";
import { evaluateIncome } from "@/lib/income";
import { buildClaimPayload } from "@/lib/claim";
import { getBankDeposits, parseBankChoice } from "@/lib/bank";
import { analyzeDocuments } from "@/lib/documents/analyze";
import { summarizeDecision } from "@/lib/documents/summary";
import { declineNotice, deliveryFromScan } from "@/lib/document-outcome";
import { readEvidenceRequest } from "@/lib/request-body";

// The tenant approved. Everything sensitive happens here, on the tenant's machine:
// tamper check -> bank data and/or documents -> compute -> sign yes/no -> send only the signed answer.
export async function POST(req: Request) {
  const body = await readEvidenceRequest(req);
  const cfg = tenantConfig();
  const portal = String(body.portal || cfg.defaultPortalUrl);
  const choice = parseBankChoice(body.tenant, body.plaidLinkId);

  const integrity = await checkIntegrity();
  if (!integrity.passed) {
    return NextResponse.json({ ok: false, code: "tampered", message: integrity.reason ?? "App integrity check failed; refusing to sign" }, { status: 403 });
  }

  const reqRes = await fetch(`${portal}/api/requests/${encodeURIComponent(body.requestId)}`, { cache: "no-store" });
  if (!reqRes.ok) return NextResponse.json({ ok: false, code: "unknown_request" }, { status: 404 });
  const { request } = (await reqRes.json()) as { request: VerificationRequest };
  const { rent, multiple } = request.question;

  let income;
  let evidence: ClaimPayload["evidence"] | undefined;
  let local: Record<string, unknown>;
  try {
    if (body.mode === "documents") {
      if (!body.files.length) return NextResponse.json({ ok: false, code: "no_documents", message: "Add at least one document" }, { status: 400 });
      const bank = body.confirmWithBank ? await getBankDeposits(choice).catch(() => undefined) : undefined;
      const decision = await analyzeDocuments(body.files, { bank, rent, multiple });
      local = { dataSource: "documents", medianMonthlyIncome: decision.monthlyIncome, evidence: decision.strength, documents: summarizeDecision(decision) };
      const delivery = deliveryFromScan(decision);
      if (delivery.action === "decline") {
        const decline = await fetch(`${portal}/api/decline`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(declineNotice(request.id)),
        });
        const declineReply = (await decline.json().catch(() => null)) as { declined?: boolean } | null;
        if (decline.ok && declineReply?.declined === true) {
          return NextResponse.json({ ok: true, outcome: "declined", declined: true, code: "documents_declined", message: decision.reason, local });
        }
        return NextResponse.json({ ok: false, code: "decline_failed", message: "The document was not accepted, and the landlord was not updated.", local }, { status: 502 });
      }
      income = { meets: delivery.meets, medianMonthlyIncome: decision.monthlyIncome, recurringPayers: [] };
      evidence = delivery.evidence;
    } else {
      const { deposits, source } = await getBankDeposits(choice);
      income = evaluateIncome(deposits, rent, multiple);
      local = { dataSource: source, medianMonthlyIncome: income.medianMonthlyIncome, evidence: "bank" };
    }
  } catch (err) {
    return NextResponse.json({ ok: false, code: "bank_unavailable", message: (err as Error).message }, { status: 502 });
  }

  const payload = await buildClaimPayload(request, { id: choice.tenant, secret: cfg.tenantSecret }, income, integrity, evidence);
  const token = await signClaim(payload, cfg.privateJwk);

  const verdict = await fetch(`${portal}/api/claims`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: request.id, token }),
  });
  const portalReply = await verdict.json();

  // Shown on the tenant's own screen only (it never left this machine).
  const outcome = evidence?.source === "document" ? (income.meets ? "accepted" : "declined") : undefined;
  return NextResponse.json({ ...portalReply, ...(outcome ? { outcome } : {}), local }, { status: verdict.status });
}
