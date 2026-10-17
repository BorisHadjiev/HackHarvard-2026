import { NextResponse } from "next/server";
import { signClaim, type ClaimPayload, type VerificationRequest } from "@ntk/shared";
import { tenantConfig } from "@/lib/config";
import { checkIntegrity } from "@/lib/integrity";
import { evaluateIncome } from "@/lib/income";
import { buildClaimPayload } from "@/lib/claim";
import { getBankDeposits, parseBankChoice } from "@/lib/bank";
import { analyzeDocuments, DOCUMENT_METHOD, DOCUMENT_WINDOW_DAYS } from "@/lib/documents/analyze";
import { proveWithBank, BankSignerError, type ZkEvidence } from "@/lib/zk-prove";
import { METHOD as ZK_METHOD, WINDOW_DAYS as ZK_WINDOW_DAYS } from "@ntk/zk";
import { summarizeDecision } from "@/lib/documents/summary";
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
  let zk: ZkEvidence | undefined;
  try {
    if (body.mode === "documents") {
      if (!body.files.length) return NextResponse.json({ ok: false, code: "no_documents", message: "Add at least one document" }, { status: 400 });
      const bank = body.confirmWithBank ? await getBankDeposits(choice).catch(() => undefined) : undefined;
      const decision = await analyzeDocuments(body.files, { bank, rent, multiple });
      local = { dataSource: "documents", medianMonthlyIncome: decision.monthlyIncome, evidence: decision.strength, documents: summarizeDecision(decision) };
      if (!decision.strength) {
        return NextResponse.json({ ok: false, code: "documents_unusable", message: decision.reason, local }, { status: 422 });
      }
      income = { meets: decision.meets, medianMonthlyIncome: decision.monthlyIncome, recurringPayers: [] };
      evidence = { source: "document", strength: decision.strength, window_days: DOCUMENT_WINDOW_DAYS, method: DOCUMENT_METHOD };
    } else {
      const { deposits, source } = await getBankDeposits(choice);
      income = evaluateIncome(deposits, rent, multiple);
      local = { dataSource: source, medianMonthlyIncome: income.medianMonthlyIncome, evidence: "bank" };
      // Demo bank accounts: the bank signs the deposits and this device proves the rule in zero knowledge.
      // (Plaid data isn't bank-signed yet, so that path sends the signed claim alone.)
      if (!choice.plaidLinkId && cfg.bankSignerUrl) {
        const proven = await proveWithBank(cfg.bankSignerUrl, choice.tenant, request);
        zk = proven.zk;
        income = { ...income, meets: proven.result }; // the proof's answer is the answer
        evidence = { source: "bank", strength: "bank", window_days: ZK_WINDOW_DAYS, method: ZK_METHOD };
        local = { ...local, proof: { provingMs: proven.provingMs, publicInputs: proven.zk.publicInputs.length } };
      }
    }
  } catch (err) {
    const code = err instanceof BankSignerError ? "bank_signer_unavailable" : "bank_unavailable";
    return NextResponse.json({ ok: false, code, message: (err as Error).message }, { status: 502 });
  }

  const payload = await buildClaimPayload(request, { id: choice.tenant, secret: cfg.tenantSecret }, income, integrity, evidence);
  const token = await signClaim(payload, cfg.privateJwk);

  const verdict = await fetch(`${portal}/api/claims`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: request.id, token, zk }),
  });
  const portalReply = await verdict.json();

  // Shown on the tenant's own screen only (it never left this machine).
  return NextResponse.json({ ...portalReply, local }, { status: verdict.status });
}
