"use client";
// Landlord portal home. Owner: Boris (UI).
import { useEffect, useState } from "react";
import type { VerificationRequest } from "@ntk/shared";

export default function Home() {
  const [rent, setRent] = useState("2400");
  const [multiple, setMultiple] = useState("3");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<"sent" | "logged" | null>(null);
  const [requests, setRequests] = useState<VerificationRequest[] | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/requests", { cache: "no-store" });
      if (!res.ok) {
        setLoadError("Could not load requests.");
        setRequests((current) => current ?? []);
        return;
      }
      setLoadError(null);
      setRequests((await res.json()).requests);
    } catch {
      setLoadError("Could not reach the portal.");
      setRequests((current) => current ?? []);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rent: Number(rent), multiple: Number(multiple), tenantPhone: phone || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not create that request.");
        return;
      }
      setLastLink(data.link);
      setDelivery(data.delivery === "sent" ? "sent" : "logged");
      refresh();
    } catch {
      setError("Could not reach the portal. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const deliveryNote = !lastLink
    ? null
    : delivery === "sent"
      ? "Text sent to the tenant."
      : phone.trim()
        ? "Photon is not configured, so this link was only logged. Share it yourself."
        : "No phone number on this request. Share the link.";

  return (
    <main>
      <header className="top">
        <span className="mark">Need-to-Know</span>
        <span className="role">Landlord</span>
      </header>
      <h1>Ask one question.</h1>
      <p className="sub">Get a verified yes or no. Balances, statements, and IDs stay on the tenant&apos;s device. <a href="/unlinkability">Two landlords still can&apos;t tell it was the same person.</a></p>

      <form className="card" onSubmit={create}>
        <label>
          <span>Monthly rent ($)</span>
          <input value={rent} onChange={(e) => setRent(e.target.value)} inputMode="decimal" aria-label="Monthly rent" />
        </label>
        <label>
          <span>Required income multiple</span>
          <input value={multiple} onChange={(e) => setMultiple(e.target.value)} inputMode="decimal" aria-label="Required income multiple" />
        </label>
        <label>
          <span>Tenant phone (optional, for the text)</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 617 555 0123" aria-label="Tenant phone" />
        </label>
        <button disabled={busy}>{busy ? "Creating…" : "Send verification request"}</button>
        {error && <p className="banner bad" role="alert">{error}</p>}
        {lastLink && deliveryNote && (
          <div className="banner">
            <p>{deliveryNote}</p>
            <p className="mono">
              Tenant link: <a href={lastLink} target="_blank" rel="noreferrer">{lastLink}</a>
            </p>
          </div>
        )}
      </form>

      <section>
        <h2>Requests</h2>
        {loadError && <p className="banner bad" role="alert">{loadError}</p>}
        {requests === null ? (
          <p className="sub">Loading requests…</p>
        ) : requests.length === 0 ? (
          <div className="card empty">No requests yet. Send one above and it will show up here.</div>
        ) : (
          requests.map((r) => (
            <div className="card row" key={r.id}>
              <div>
                <div className="ask">Income at least {r.question.multiple}× ${r.question.rent.toLocaleString("en-US")} rent?</div>
                <div className="mono">{r.id}</div>
              </div>
              <Status r={r} />
            </div>
          ))
        )}
      </section>
    </main>
  );
}

function Status({ r }: { r: VerificationRequest }) {
  if (r.status !== "verified" || !r.result) return <span className="pill">Waiting for tenant</span>;
  return r.result.answer
    ? <span className="pill ok">✓ Verified: meets requirement</span>
    : <span className="pill bad">✗ Verified: does not meet requirement</span>;
}
