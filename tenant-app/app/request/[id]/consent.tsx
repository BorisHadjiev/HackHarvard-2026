"use client";
// Consent screen (interactive part). Owner: Boris (UI).
import { useState } from "react";
import type { VerificationRequest } from "@ntk/shared";
import EvidencePicker, { DocumentReport, STRENGTH_LABELS, type Decision, type Mode } from "./evidence";

type Reply = { ok: boolean; answer?: boolean; outcome?: "accepted" | "declined"; declined?: boolean; code?: string; message?: string; local?: { dataSource: string; medianMonthlyIncome: number; evidence?: string | null; documents?: Decision; proof?: { provingMs: number } } };

export default function Consent({ request, portal, tenants, recordedAnswer = null, plaidConfigured = false }: { request: VerificationRequest; portal: string; tenants: Record<string, string>; recordedAnswer?: boolean | null; plaidConfigured?: boolean }) {
  const [tenant, setTenant] = useState(Object.keys(tenants)[0] ?? "");
  const [mode, setMode] = useState<Mode>("documents");
  const [plaidLinkId, setPlaidLinkId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [confirmWithBank, setConfirmWithBank] = useState(true);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const q = request.question;
  // Type-narrowing only (Sam, age-claim contract). Boris owns the age consent screen itself.
  const income = q.type === "income_to_rent" ? q : null;
  const declinedOnRecord = request.status === "rejected";
  const expired = recordedAnswer == null && !declinedOnRecord && request.status !== "verified" && Date.parse(request.expiresAt) < Date.now();
  const alreadyAnswered = recordedAnswer == null && request.status === "verified";
  const closed = expired || alreadyAnswered || recordedAnswer != null || declinedOnRecord || declined || reply?.ok === true;

  async function decline() {
    setBusy(true);
    setSendError(null);
    try {
      const res = await fetch("/api/decline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: request.id, portal }),
      });
      const body = (await res.json().catch(() => null)) as { declined?: boolean } | null;
      if (!res.ok || body?.declined !== true) {
        setSendError("The decline didn't go through. No financial data was sent.");
        return;
      }
      setDeclined(true);
    } catch {
      setSendError("Couldn't reach the landlord. The decline was not confirmed.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!consent || closed) return;
    setBusy(true);
    setSendError(null);
    setReply(null);
    try {
      let res: Response;
      if (mode === "documents") {
        const form = new FormData();
        form.set("requestId", request.id);
        form.set("portal", portal);
        form.set("tenant", tenant);
        form.set("mode", "documents");
        form.set("confirmWithBank", String(confirmWithBank));
        if (plaidLinkId) form.set("plaidLinkId", plaidLinkId);
        for (const f of files) form.append("documents", f);
        res = await fetch("/api/approve", { method: "POST", body: form });
      } else {
        res = await fetch("/api/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requestId: request.id, portal, tenant, plaidLinkId: plaidLinkId ?? undefined }),
        });
      }
      const body = (await res.json().catch(() => null)) as Reply | null;
      if (!body || typeof body.ok !== "boolean") {
        setSendError("The app got an unreadable response. Check with the landlord before trying again.");
        return;
      }
      setReply(body);
    } catch {
      setSendError("Couldn't reach this app's checker. Nothing was confirmed as sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <p className="kicker">The question · {request.requesterName}</p>
        {income ? (<>
        <h2 className="question-line">Is your income at least {income.multiple}× the ${income.rent.toLocaleString("en-US")} monthly rent?</h2>
        <div className="threshold"><span>Monthly rent · set by landlord</span><strong>${income.rent.toLocaleString("en-US")} <small>× {income.multiple}</small></strong><p>Income requirement: ${(income.rent * income.multiple).toLocaleString("en-US")} / month. Your actual income is never shared.</p></div>
        </>) : (
        <h2 className="question-line">Are you at least 18?</h2>
        )}
      </section>

      <section className="card privacy-panel">
        <p className="kicker">You stay in control</p><h2>Shared with the landlord</h2>
        <ul className="plain">
          <li>One signed yes or no</li>
          <li>The question above, so the answer matches what they asked</li>
          <li>How it was checked, for example &ldquo;bank-verified&rdquo; or &ldquo;documents confirmed by bank&rdquo;</li>
        </ul>
        <h2 className="private-heading">Stays on your device</h2>
        <ul className="plain">
          <li>No documents or statements</li>
          <li>No balances or deposits</li>
          <li>No dollar amounts</li>
        </ul>
        <p className="hint">Checked on this device: your recent bank deposits, or the income documents you choose. The landlord never sees that data.</p>
      </section>

      {expired && <p className="banner bad" role="status">This request expired. Ask {request.requesterName} for a new link. Nothing will be sent.</p>}
      {alreadyAnswered && <p className="banner wait" role="status">This question was already answered. A second answer will not be sent.</p>}
      {recordedAnswer != null && (
        <section className="card" role="status">
          <p className="kicker">Already sent</p>
          <p className={recordedAnswer ? "verdict ok" : "verdict bad"}>{recordedAnswer ? "Yes — meets the requirement" : "No — does not meet the requirement"}</p>
          <p className="hint">{request.requesterName} already has this answer. Nothing new is sent, and no dollar amount is on this page.</p>
        </section>
      )}

      {!closed && (
        <section className="card">
          <EvidencePicker
            mode={mode} setMode={setMode}
            tenants={tenants} tenant={tenant} setTenant={setTenant}
            plaidConfigured={plaidConfigured} plaidLinkId={plaidLinkId} setPlaidLinkId={setPlaidLinkId}
            files={files} setFiles={setFiles}
            confirmWithBank={confirmWithBank} setConfirmWithBank={setConfirmWithBank}
            rent={income?.rent ?? 0} multiple={income?.multiple ?? 0} disabled={busy}
          />
          {sendError && <p className="banner bad" role="alert">{sendError}</p>}
          <label className="consent-check"><input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} /><span>I agree to share only my eligibility result and verification metadata for this request.</span></label>
          <div className="actions">
            <button type="button" className="secondary" onClick={decline} disabled={busy}>Decline</button>
            <button type="button" onClick={approve} disabled={busy || !tenant || !consent || (mode === "documents" && !files.length)}>{busy ? "Checking the document on this device…" : mode === "documents" ? "Check document & share result →" : "Approve & share result →"}</button>
          </div>
          <p className="hint">The document check sends only a yes or no. Decline tells them you declined and sends no financial data.</p>
        </section>
      )}

      {(declined || declinedOnRecord) && (
        <section className="card" role="status">
          <p className="verdict declined">Declined</p>
          <p className="hint">You declined. {request.requesterName} can see that, and no financial data was sent.</p>
        </section>
      )}

      {reply && (
        <section className="card" role="status">
          {reply.ok && reply.outcome === "declined" ? (
            <>
              <p className="verdict declined">Declined</p>
              <p className="hint">The document check declined this request. {request.requesterName} can see that. No document, balance, or dollar amount was sent.</p>
            </>
          ) : reply.ok ? (
            <>
              <span className="seal" aria-hidden="true">✓</span><p className="kicker">Signed result shared</p>
              <p className={reply.answer ? "verdict ok" : "verdict bad"}>{reply.answer ? (reply.outcome === "accepted" ? "Accepted — meets the requirement" : "Yes — meets the requirement") : "No — does not meet the requirement"}</p>
              <p className="hint">{request.requesterName} now sees that answer{reply.local?.evidence ? `, marked “${STRENGTH_LABELS[reply.local.evidence]}”` : ""}. They do not see a dollar amount or any document.</p>
            </>
          ) : (
            <p className="banner bad">{explain(reply)}</p>
          )}
          {reply.local?.documents && <DocumentReport decision={reply.local.documents} />}
          {reply.local && !reply.local.documents && (
            <div className="card private field-last">
              <p className="kicker">Only on this device — not sent</p>
              <p className="mono">
                Median monthly recurring income ${Math.round(reply.local.medianMonthlyIncome).toLocaleString("en-US")} (source: {reply.local.dataSource})
              </p>
              {reply.local.proof && (
                <p className="hint">Zero-knowledge proof made here in {(reply.local.proof.provingMs / 1000).toFixed(1)} s. The landlord checked it against your bank&apos;s signature without seeing a single deposit.</p>
              )}
            </div>
          )}
        </section>
      )}
      {closed && <a className="button secondary" href={portal}>Return to landlord portal ↗</a>}
      <p className="page-footer">Your choice. Your data. Only the answer leaves this device.</p>
    </>
  );
}

function explain(reply: Reply): string {
  switch (reply.code) {
    case "tampered":
      return "This copy of the app failed its integrity check, so it refused to sign. Nothing was sent.";
    case "replayed":
      return "This question was already answered. A second answer was not sent.";
    case "unknown_request":
      return "This request is no longer open. Nothing was sent.";
    case "request_expired":
      return "This request expired. Nothing was sent.";
    case "wrong_question":
      return "The answer did not match the question, so it was rejected.";
    case "documents_unusable":
      return "None of the documents passed the checks, so nothing was signed or sent. See why below.";
    case "decline_failed":
      return "The document was not accepted, and the landlord was not updated. Nothing financial was sent.";
    case "no_documents":
      return "Add at least one document first.";
    case "bank_unavailable":
      return `Couldn't read your bank data (${reply.message}). Nothing was sent.`;
    case "bank_signer_unavailable":
      return `${reply.message}. Start it with npm run dev. Nothing was sent.`;
    case "proof_required":
      return "This landlord only accepts answers with a zero-knowledge proof. Use a demo bank account.";
    case "bad_proof":
    case "proof_mismatch":
    case "bad_bank_attestation":
      return `The landlord rejected the proof (${reply.message}). Nothing was recorded.`;
    default:
      return reply.message || "The answer was not accepted. Nothing new was sent.";
  }
}
