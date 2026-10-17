"use client";
// Consent screen (interactive part). Owner: Boris (UI). Works end to end with placeholder styling.
import { useState } from "react";
import type { VerificationRequest } from "@ntk/shared";

type Reply = { ok: boolean; answer?: boolean; code?: string; message?: string; local?: { dataSource: string; medianMonthlyIncome: number } };

export default function Consent({ request, portal, tenants }: { request: VerificationRequest; portal: string; tenants: Record<string, string> }) {
  const [tenant, setTenant] = useState(Object.keys(tenants)[0]);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const q = request.question;

  async function approve() {
    setBusy(true);
    const res = await fetch("/api/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: request.id, portal, tenant }),
    });
    setReply(await res.json());
    setBusy(false);
  }

  return (
    <>
      <div className="card">
        <p><b>They are asking:</b> Is your income at least {q.multiple}× the ${q.rent.toLocaleString("en-US")} monthly rent?</p>
        <p><b>They will receive:</b> one signed yes or no. No balances, no statements, no documents.</p>
        <p><b>We will check:</b> the last 90 days of recurring deposits in your bank account, on this device.</p>
        <label>Bank account (demo)
          <select value={tenant} onChange={(e) => setTenant(e.target.value)} style={{ display: "block", marginTop: 4, padding: 8, width: "100%" }}>
            {Object.entries(tenants).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <button onClick={approve} disabled={busy}>{busy ? "Checking…" : "Approve and send yes/no"}</button>
      </div>

      {reply && (
        <div className="card">
          {reply.ok ? (
            <p>Sent. The landlord now sees: <b>{reply.answer ? "✓ meets requirement" : "✗ does not meet requirement"}</b></p>
          ) : (
            <p className="pill bad" style={{ display: "inline-block" }}>Rejected: {reply.message ?? reply.code}</p>
          )}
          {reply.local && (
            <p className="mono">
              Only you see this: median monthly recurring income ${Math.round(reply.local.medianMonthlyIncome).toLocaleString("en-US")} (source: {reply.local.dataSource})
            </p>
          )}
        </div>
      )}
    </>
  );
}
