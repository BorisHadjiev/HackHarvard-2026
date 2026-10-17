"use client";
// Consent screen (interactive part). Owner: Boris (UI).
import { useState } from "react";
import type { VerificationRequest } from "@ntk/shared";

type Reply = { ok: boolean; answer?: boolean; code?: string; message?: string; local?: { dataSource: string; medianMonthlyIncome: number } };
type Verdict = { answer: boolean } | null;

export default function Consent({
  request,
  portal,
  tenants,
  verdict,
}: {
  request: VerificationRequest;
  portal: string;
  tenants: Record<string, string>;
  verdict: Verdict;
}) {
  const [tenant, setTenant] = useState(Object.keys(tenants)[0]);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const q = request.question;

  async function approve() {
    setBusy(true);
    setReply(null);
    try {
      const res = await fetch("/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: request.id, portal, tenant }),
      });
      const data = await res.json().catch(() => null);
      if (!data || typeof data !== "object") {
        setReply({ ok: false, message: "The app could not read a response. Try again." });
      } else {
        setReply(data as Reply);
      }
    } catch {
      setReply({ ok: false, message: "Could not reach this device's app. Try again." });
    } finally {
      setBusy(false);
    }
  }

  if (request.status === "verified") {
    const answer = reply?.answer ?? verdict?.answer;
    return (
      <div className="card">
        <p className="fact"><b>Already answered</b> This one-time question has a verified result. A second answer is rejected.</p>
        {answer === undefined ? (
          <p className="verdict">The landlord already has a yes or no.</p>
        ) : (
          <p className={answer ? "verdict ok" : "verdict bad"}>{answer ? "✓ Meets the requirement" : "✗ Does not meet the requirement"}</p>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <p className="fact"><b>They are asking</b> Is your income at least {q.multiple}× the ${q.rent.toLocaleString("en-US")} monthly rent?</p>
        <p className="fact"><b>They will receive</b> One signed yes or no. No balances, no statements, no documents.</p>
        <p className="fact"><b>Checked on this device</b> The last 90 days of recurring deposits in the bank account you pick.</p>
        <label>
          <span>Bank account (demo)</span>
          <select value={tenant} onChange={(e) => setTenant(e.target.value)} aria-label="Bank account">
            {Object.entries(tenants).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <button onClick={approve} disabled={busy}>{busy ? "Checking…" : "Approve and send yes/no"}</button>
      </div>

      {reply && (
        <div className="card">
          {reply.ok ? (
            <p className={reply.answer ? "verdict ok" : "verdict bad"}>
              {reply.answer ? "✓ Meets the requirement" : "✗ Does not meet the requirement"}
            </p>
          ) : (
            <p className="pill bad" role="alert">Rejected: {reply.message ?? reply.code}</p>
          )}
          {reply.ok && <p className="sub">Sent. The landlord sees that answer and nothing else.</p>}
          {reply.local && (
            <p className="mono private">
              Only you see this: median monthly recurring income ${Math.round(reply.local.medianMonthlyIncome).toLocaleString("en-US")} (source: {reply.local.dataSource})
            </p>
          )}
        </div>
      )}
    </>
  );
}
