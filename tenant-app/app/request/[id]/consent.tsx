"use client";
// Consent screen (interactive part). Owner: Boris (UI).
import { useState } from "react";
import type { VerificationRequest } from "@ntk/shared";

type Reply = { ok: boolean; answer?: boolean; code?: string; message?: string; local?: { dataSource: string; medianMonthlyIncome: number } };

export default function Consent({ request, portal, tenants, recordedAnswer = null }: { request: VerificationRequest; portal: string; tenants: Record<string, string>; recordedAnswer?: boolean | null }) {
  const [tenant, setTenant] = useState(Object.keys(tenants)[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const q = request.question;
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
    setBusy(true);
    setSendError(null);
    setReply(null);
    try {
      const res = await fetch("/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: request.id, portal, tenant }),
      });
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
        <p className="kicker">They are asking</p>
        <h2 className="question-line">Is your income at least {q.multiple}× the ${q.rent.toLocaleString("en-US")} monthly rent?</h2>
      </section>

      <section className="card">
        <h2>What they will receive</h2>
        <ul className="plain">
          <li>One signed yes or no</li>
          <li>The question above, so the answer matches what they asked</li>
        </ul>
        <h2>What stays private</h2>
        <ul className="plain">
          <li>No documents or statements</li>
          <li>No balances or deposits</li>
          <li>No dollar amounts</li>
        </ul>
        <p className="hint">Checked on this device: the last 90 days of recurring deposits. The landlord never sees that data.</p>
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
          <label htmlFor="demo-account">
            Demo bank account
            <select id="demo-account" value={tenant} onChange={(e) => setTenant(e.target.value)}>
              {Object.entries(tenants).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <span className="hint">Sample accounts for the demo. Maya meets a typical 3× rule. Leo does not.</span>
          </label>
          {sendError && <p className="banner bad" role="alert">{sendError}</p>}
          <div className="actions">
            <button type="button" className="secondary" onClick={decline} disabled={busy}>Decline</button>
            <button type="button" onClick={approve} disabled={busy || !tenant}>{busy ? "Checking on this device…" : "Approve"}</button>
          </div>
          <p className="hint">Approve sends only a yes or no. Decline tells them you declined and sends no financial data.</p>
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
          {reply.ok ? (
            <>
              <p className="kicker">Sent</p>
              <p className={reply.answer ? "verdict ok" : "verdict bad"}>{reply.answer ? "Yes — meets the requirement" : "No — does not meet the requirement"}</p>
              <p className="hint">{request.requesterName} now sees that answer. They do not see a dollar amount.</p>
            </>
          ) : (
            <p className="banner bad">{explain(reply)}</p>
          )}
          {reply.local && (
            <div className="card private field-last">
              <p className="kicker">Only on this device — not sent</p>
              <p className="mono">
                Median monthly recurring income ${Math.round(reply.local.medianMonthlyIncome).toLocaleString("en-US")} (source: {reply.local.dataSource})
              </p>
            </div>
          )}
        </section>
      )}
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
    default:
      return reply.message || "The answer was not accepted. Nothing new was sent.";
  }
}
