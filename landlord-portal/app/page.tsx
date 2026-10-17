"use client";
// Landlord portal home. Owner: Boris (UI). Works end to end with placeholder styling.
import { useEffect, useState } from "react";
import type { VerificationRequest } from "@ntk/shared";

export default function Home() {
  const [rent, setRent] = useState("2400");
  const [multiple, setMultiple] = useState("3");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [requests, setRequests] = useState<VerificationRequest[]>([]);

  async function refresh() {
    const res = await fetch("/api/requests", { cache: "no-store" });
    if (res.ok) setRequests((await res.json()).requests);
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000); // poll so the result appears as soon as the tenant approves
    return () => clearInterval(t);
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rent: Number(rent), multiple: Number(multiple), tenantPhone: phone || undefined }),
    });
    setBusy(false);
    if (res.ok) {
      setLastLink((await res.json()).link);
      refresh();
    }
  }

  return (
    <main>
      <h1>Need-to-Know</h1>
      <p className="sub">Ask a tenant one question. Get a verified yes or no, never their documents.</p>

      <form className="card" onSubmit={create}>
        <label>Monthly rent ($)<input value={rent} onChange={(e) => setRent(e.target.value)} inputMode="numeric" /></label>
        <label>Required income multiple<input value={multiple} onChange={(e) => setMultiple(e.target.value)} inputMode="decimal" /></label>
        <label>Tenant phone (optional, for the text)<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 617 555 0123" /></label>
        <button disabled={busy}>{busy ? "Creating…" : "Send verification request"}</button>
        {lastLink && (
          <p className="mono">
            Tenant link: <a href={lastLink} target="_blank" rel="noreferrer">{lastLink}</a>
          </p>
        )}
      </form>

      {requests.map((r) => (
        <div className="card row" key={r.id}>
          <div>
            <div>Income at least {r.question.multiple}× ${r.question.rent.toLocaleString("en-US")} rent?</div>
            <div className="mono">{r.id}</div>
          </div>
          <Status r={r} />
        </div>
      ))}
    </main>
  );
}

function Status({ r }: { r: VerificationRequest }) {
  if (r.status !== "verified" || !r.result) return <span className="pill">Waiting for tenant</span>;
  return r.result.answer
    ? <span className="pill ok">✓ Verified: meets requirement</span>
    : <span className="pill bad">✗ Verified: does not meet requirement</span>;
}
