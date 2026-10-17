"use client";
// Consent screen (interactive part). Owner: Boris (UI).
import { useState } from "react";
import { EVIDENCE_LABELS, type EvidenceStrength, type VerificationRequest } from "@ntk/shared";
import EvidencePicker, { DocumentReport, STRENGTH_LABELS, type Decision, type Mode } from "./evidence";

type ConsentProps = {
  request: VerificationRequest;
  portal: string;
  tenants: Record<string, string>;
  recordedAnswer?: boolean | null;
  recordedEvidence?: string | null;
  plaidConfigured?: boolean;
};

type Reply = { ok: boolean; answer?: boolean; outcome?: "accepted" | "declined"; declined?: boolean; code?: string; message?: string; local?: { dataSource: string; medianMonthlyIncome: number; evidence?: string | null; documents?: Decision } };

export default function Consent(props: ConsentProps) {
  if (props.request.question.type === "age_over") return <AgeConsent {...props} />;
  return <IncomeConsent {...props} />;
}

function IncomeConsent({ request, portal, tenants, recordedAnswer = null, plaidConfigured = false }: ConsentProps) {
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
  const q = request.question.type === "income_to_rent" ? request.question : null;
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

  if (!q) return null;

  return (
    <>
      <section className="card">
        <p className="kicker">The question · {request.requesterName}</p>
        <h2 className="question-line">Is your income at least {q.multiple}× the ${q.rent.toLocaleString("en-US")} monthly rent?</h2>
        <div className="threshold"><span>Monthly rent · set by landlord</span><strong>${q.rent.toLocaleString("en-US")} <small>× {q.multiple}</small></strong><p>Income requirement: ${(q.rent * q.multiple).toLocaleString("en-US")} / month. Your actual income is never shared.</p></div>
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
            rent={q.rent} multiple={q.multiple} disabled={busy}
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
    default:
      return reply.message || "The answer was not accepted. Nothing new was sent.";
  }
}

type CheckStatus = "pass" | "warn" | "fail" | "info";
type ShownCheck = { id: string; status: CheckStatus; label: string };
type AgeReply = { ok: boolean; answer?: boolean; outcome?: string; declined?: boolean; code?: string };

const CHECK_ICON: Record<CheckStatus, string> = { pass: "✓", warn: "!", fail: "✗", info: "·" };
const CHECK_WORD: Record<CheckStatus, string> = { pass: "Passed", warn: "Warning", fail: "Failed", info: "Note" };
const KNOWN_CHECK_LABELS: Record<string, string> = {
  dob_found: "Date of birth found",
  dob_plausible: "Date of birth looks valid",
  not_expired: "Not expired",
  mrz_check_digits: "Check digits match",
  barcode_matches_front: "Barcode matches the front",
};

function labelLeaks(label: string): boolean {
  if (/\$/.test(label)) return true;
  if (/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(label)) return true;
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(label)) return true;
  if (/\b(?:19|20)\d{2}\b/.test(label)) return true;
  if (/\b\d{6,}\b/.test(label)) return true;
  if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i.test(label)) return true;
  return false;
}

function asChecks(value: unknown): ShownCheck[] {
  if (!Array.isArray(value)) return [];
  const out: ShownCheck[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as { id?: unknown; status?: unknown; label?: unknown };
    const status = raw.status;
    if (status !== "pass" && status !== "warn" && status !== "fail" && status !== "info") continue;
    const id = typeof raw.id === "string" && raw.id ? raw.id : `check-${out.length}`;
    const fromServer = typeof raw.label === "string" ? raw.label.trim() : "";
    const label = KNOWN_CHECK_LABELS[id] ?? (fromServer && !labelLeaks(fromServer) ? fromServer : "");
    if (!label) continue;
    out.push({ id, status, label });
  }
  return out;
}

/** Labels and pass/fail only. Dates, dollar amounts, and ID numbers are dropped. */
function checksFrom(body: unknown, depth = 0): ShownCheck[] {
  if (!body || typeof body !== "object" || depth > 3) return [];
  const record = body as Record<string, unknown>;
  const direct = asChecks(record.checks);
  if (direct.length) return direct;
  if (Array.isArray(record.documents)) {
    const nested = record.documents.flatMap((doc) => asChecks(doc && typeof doc === "object" ? (doc as { checks?: unknown }).checks : undefined));
    if (nested.length) return nested;
  }
  if (record.documents && typeof record.documents === "object") {
    const nested = checksFrom(record.documents, depth + 1);
    if (nested.length) return nested;
  }
  if (record.local && typeof record.local === "object") return checksFrom(record.local, depth + 1);
  return [];
}

function evidenceText(value: unknown): string | null {
  if (value === "bank" || value === "document_signed" || value === "document_bank_matched" || value === "document_unverified") {
    return EVIDENCE_LABELS[value as EvidenceStrength];
  }
  return null;
}

function CheckList({ checks }: { checks: ShownCheck[] }) {
  if (!checks.length) return null;
  return (
    <div className="field-last">
      <p className="kicker">Checks on this device</p>
      <ul className="plain checks">
        {checks.map((c, i) => (
          <li key={`${c.id}-${i}`} className={`check ${c.status}`}>
            <span aria-hidden="true">{CHECK_ICON[c.status]}</span>{" "}
            <span className="sr-only">{CHECK_WORD[c.status]}: </span>
            {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ageFailure(code: string | undefined): string {
  switch (code) {
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
    case "unsupported_question":
      return "This build can't read an ID yet, so nothing was signed or sent.";
    case "no_documents":
      return "Add a photo or PDF of the ID first.";
    default:
      return "The answer was not accepted. Nothing was sent.";
  }
}

function previewFailure(body: unknown): string {
  const error = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : "";
  if (/rent|multiple|income questions only/i.test(error)) return "This build can't read an ID yet. Nothing was sent.";
  if (/at least one/i.test(error)) return "Add a photo or PDF of the ID first.";
  return "The ID check didn't finish. Nothing was sent.";
}

function AgeConsent({ request, portal, tenants, recordedAnswer = null, recordedEvidence = null }: ConsentProps) {
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [reply, setReply] = useState<AgeReply | null>(null);
  const [evidence, setEvidence] = useState<string | null>(recordedEvidence);
  const [checks, setChecks] = useState<ShownCheck[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
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
        setSendError("The decline didn't go through. Nothing was sent.");
        return;
      }
      setDeclined(true);
    } catch {
      setSendError("Couldn't reach the landlord. The decline was not confirmed.");
    } finally {
      setBusy(false);
    }
  }

  async function readId() {
    if (!file) return;
    setChecking(true);
    setPreviewError(null);
    try {
      const form = new FormData();
      form.set("mode", "age");
      form.set("requestId", request.id);
      form.set("portal", portal);
      form.append("documents", file);
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const body: unknown = await res.json().catch(() => null);
      const found = checksFrom(body);
      if (found.length) setChecks(found);
      if (!res.ok) setPreviewError(previewFailure(body));
    } catch {
      setPreviewError("The ID check didn't finish. Nothing was sent.");
    } finally {
      setChecking(false);
    }
  }

  async function approve() {
    if (!consent || closed || !file) return;
    setBusy(true);
    setSendError(null);
    setReply(null);
    try {
      const form = new FormData();
      form.set("requestId", request.id);
      form.set("portal", portal);
      form.set("tenant", Object.keys(tenants)[0] ?? "");
      form.set("mode", "age");
      form.set("confirmWithBank", "false");
      form.append("documents", file);
      const res = await fetch("/api/approve", { method: "POST", body: form });
      const body: unknown = await res.json().catch(() => null);
      if (!body || typeof body !== "object" || typeof (body as { ok?: unknown }).ok !== "boolean") {
        setSendError("The app got an unreadable response. Check with the landlord before trying again.");
        return;
      }
      const raw = body as { ok: boolean; answer?: unknown; outcome?: unknown; declined?: unknown; code?: unknown; evidence?: unknown; local?: { evidence?: unknown } };
      const found = checksFrom(body);
      if (found.length) setChecks(found);
      setEvidence(evidenceText(raw.evidence) ?? evidenceText(raw.local?.evidence));
      setReply({
        ok: raw.ok,
        answer: raw.answer === true ? true : raw.answer === false ? false : undefined,
        outcome: typeof raw.outcome === "string" ? raw.outcome : undefined,
        declined: raw.declined === true,
        code: typeof raw.code === "string" ? raw.code : undefined,
      });
    } catch {
      setSendError("Couldn't reach this app's checker. Nothing was confirmed as sent.");
    } finally {
      setBusy(false);
    }
  }

  const sharedYes = reply?.ok === true && reply.answer === true && reply.outcome !== "declined" && !reply.declined;
  const sharedNo = reply?.ok === true && reply.answer === false && reply.outcome !== "declined" && !reply.declined;
  const sharedDecline = reply?.ok === true && (reply.outcome === "declined" || reply.declined === true);

  return (
    <>
      <section className="card privacy-panel">
        <p className="kicker">You stay in control</p>
        <h2>Shared with the landlord</h2>
        <ul className="plain">
          <li>One signed yes or no</li>
          <li>That an ID was read on this device</li>
        </ul>
        <h2 className="private-heading">Stays on your device</h2>
        <ul className="plain">
          <li>Your date of birth</li>
          <li>Your name</li>
          <li>Your ID number</li>
        </ul>
      </section>

      {expired && <p className="banner bad" role="status">This request expired. Ask {request.requesterName} for a new link. Nothing will be sent.</p>}
      {alreadyAnswered && <p className="banner wait" role="status">This question was already answered. A second answer will not be sent.</p>}
      {recordedAnswer != null && (
        <section className="card" role="status">
          <p className="kicker">Already sent</p>
          <p className={recordedAnswer ? "verdict ok" : "verdict bad"}>{recordedAnswer ? "✓ 18 or older" : "✗ Under 18"}</p>
          {recordedEvidence && <p className={recordedEvidence === EVIDENCE_LABELS.document_unverified ? "meta evidence weak" : "meta evidence"}>{recordedEvidence}</p>}
          <p className="hint">{request.requesterName} already has this answer. Your date of birth, name, and ID number stayed on this device.</p>
        </section>
      )}

      {!closed && (
        <section className="card">
          <label htmlFor="id-document" className="file-pick">
            Photo or PDF of your ID
            <input
              id="id-document"
              className="sr-only"
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif"
              disabled={busy || checking}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setChecks([]);
                setPreviewError(null);
              }}
            />
            <span className="file-button">{file ? (file.type === "application/pdf" ? "PDF selected" : "Photo selected") : "Choose photo or PDF"}</span>
            <span className="hint">A photo or PDF of a driver&apos;s license (the back with the barcode works best), state ID, or passport photo page.</span>
          </label>
          <div className="actions">
            <button type="button" className="secondary" onClick={readId} disabled={busy || checking || !file}>
              {checking ? "Reading the ID on this device…" : "Check ID on this device"}
            </button>
          </div>
          {previewError && <p className="banner bad" role="alert">{previewError}</p>}
          {!reply && <CheckList checks={checks} />}
          {sendError && <p className="banner bad" role="alert">{sendError}</p>}
          <label className="consent-check">
            <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} />
            <span>I agree to share only yes or no for this request.</span>
          </label>
          <div className="actions">
            <button type="button" className="secondary" onClick={decline} disabled={busy}>Decline</button>
            <button type="button" onClick={approve} disabled={busy || checking || !consent || !file}>
              {busy ? "Checking the ID on this device…" : "Check ID & share result →"}
            </button>
          </div>
          <p className="hint">The landlord learns only yes or no. Decline tells them you declined, and the ID stays here.</p>
        </section>
      )}

      {(declined || declinedOnRecord) && (
        <section className="card" role="status">
          <p className="verdict declined">Declined</p>
          <p className="hint">You declined. {request.requesterName} can see that. Your date of birth, name, and ID number stayed on this device.</p>
        </section>
      )}

      {reply && (
        <section className="card" role="status">
          {sharedDecline ? (
            <>
              <p className="verdict declined">Declined</p>
              <p className="hint">The ID check declined this request. {request.requesterName} can see that. Your date of birth, name, and ID number stayed on this device.</p>
            </>
          ) : sharedYes || sharedNo ? (
            <>
              <span className="seal" aria-hidden="true">{sharedYes ? "✓" : "✗"}</span>
              <p className="kicker">Signed result shared</p>
              <p className={sharedYes ? "verdict ok" : "verdict bad"}>{sharedYes ? "✓ 18 or older" : "✗ Under 18"}</p>
              {evidence && <p className={evidence === EVIDENCE_LABELS.document_unverified ? "meta evidence weak" : "meta evidence"}>{evidence}</p>}
              <p className="hint">{request.requesterName} now sees that answer. Your date of birth, name, and ID number stayed on this device.</p>
            </>
          ) : (
            <p className="banner bad">{ageFailure(reply.code)}</p>
          )}
          <CheckList checks={checks} />
        </section>
      )}
      {checks.length > 0 && !reply && closed && (
        <section className="card private" role="status">
          <CheckList checks={checks} />
        </section>
      )}
      {closed && <a className="button secondary" href={portal}>Return to landlord portal ↗</a>}
      <p className="page-footer">Your choice. Your data. Only the answer leaves this device.</p>
    </>
  );
}
