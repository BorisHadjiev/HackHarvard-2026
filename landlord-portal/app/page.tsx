"use client";
// Landlord portal home. Owner: Boris (UI).
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { EVIDENCE_LABELS, type VerificationRequest } from "@ntk/shared";

type Share = { id: string; link: string };

export default function Home() {
  const [rent, setRent] = useState("2400");
  const [multiple, setMultiple] = useState("3");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [share, setShare] = useState<Share | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<"sent" | "logged" | null>(null);
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/requests", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setRequests((await res.json()).requests);
      setLoadError(null);
    } catch {
      setLoadError("Couldn't load requests. They'll retry automatically.");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    const tick = () => { refresh(); };
    tick();
    const t = setInterval(tick, 2000); // poll so the result appears as soon as the tenant approves
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!share) return;
    document.getElementById("share-title")?.scrollIntoView({ block: "nearest" });
  }, [share]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setCopied(false);
    setCopyError(null);
    const rentValue = Number(rent);
    const multipleValue = Number(multiple);
    if (!Number.isFinite(rentValue) || rentValue <= 0 || !Number.isFinite(multipleValue) || multipleValue <= 0) {
      setFormError("Enter a rent and a multiple greater than zero.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rent: rentValue, multiple: multipleValue, tenantPhone: phone || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.link || !data.request?.id) {
        setFormError(typeof data.error === "string" ? data.error : "The request was not created. Try again.");
        return;
      }
      setShare({ id: data.request.id, link: data.link });
      setDelivery(data.delivery === "sent" ? "sent" : "logged");
      setLinks((prev) => ({ ...prev, [data.request.id]: data.link }));
      refresh();
    } catch {
      setFormError("Couldn't reach the portal. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.link);
      setCopied(true);
      setCopyError(null);
    } catch {
      setCopied(false);
      setCopyError("Couldn't copy automatically. Select the tenant link and copy it.");
    }
  }

  const preview = questionLine(Number(multiple), Number(rent));
  const deliveryNote = !share
    ? null
    : delivery === "sent"
      ? "Text sent to the tenant."
      : phone.trim()
        ? "Photon is not configured, so this link was only logged. Share it yourself."
        : "No phone number on this request. Share the link.";

  return (
    <main>
      <h1>Ask one question</h1>
      <p className="sub">
        A tenant proves this on their own device. You get a signed yes or no — never their balances, deposits, or documents.{" "}
        <a href="/unlinkability">Two landlords still can&apos;t tell it was the same person.</a>
      </p>

      <form className="card" onSubmit={create}>
        <p className="kicker">The question</p>
        <p className="question-line">{preview}</p>
        <p className="hint gap">This is the only fact the tenant is asked to prove.</p>

        <label>
          Monthly rent ($)
          <input value={rent} onChange={(e) => setRent(e.target.value)} inputMode="decimal" aria-label="Monthly rent in dollars" />
        </label>
        <label>
          Required income multiple
          <input value={multiple} onChange={(e) => setMultiple(e.target.value)} inputMode="decimal" aria-label="Required income multiple" />
          <span className="hint">3 means income must be at least three times the rent.</span>
        </label>
        <label>
          Tenant phone (optional)
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 617 555 0123" inputMode="tel" autoComplete="tel" />
          <span className="hint">Optional. If Photon is configured, we text this number. You also get a link to open or copy.</span>
        </label>
        {formError && <p className="banner bad" role="alert">{formError}</p>}
        <button disabled={busy}>{busy ? "Creating…" : "Send verification request"}</button>
      </form>

      {share && (
        <section className="card current" aria-labelledby="share-title">
          <p className="kicker">Tenant link</p>
          <h2 id="share-title">Open the consent screen, or copy this link</h2>
          {deliveryNote && <p className="hint gap-sm">{deliveryNote}</p>}
          <p className="hint gap-sm">The tenant reviews the question and chooses approve or decline. Nothing financial is sent until they approve.</p>
          <div className="actions">
            <a className="button" href={share.link} target="_blank" rel="noreferrer">Open tenant consent</a>
            <button type="button" className="secondary" onClick={copyLink}>{copied ? "Copied" : "Copy link"}</button>
          </div>
          {copyError && <p className="banner bad" role="alert">{copyError}</p>}
          <label className="field-last">
            Tenant link
            <input readOnly value={share.link} aria-label="Tenant link" onFocus={(e) => e.currentTarget.select()} />
          </label>
        </section>
      )}

      <div className="section-head">
        <h2>Requests</h2>
      </div>
      {!loaded && <p className="empty">Loading requests…</p>}
      {loadError && <p className="banner bad" role="alert">{loadError}</p>}
      {loaded && !loadError && requests.length === 0 && (
        <p className="empty">No requests yet. Send one above, then open the tenant link.</p>
      )}
      <div aria-live="polite">
        {requests.map((r) => (
          <article className={r.id === share?.id ? "card row current" : "card row"} key={r.id}>
            <div>
              <h3 className="question-line">{questionLine(r.question.multiple, r.question.rent)}</h3>
              <p className="meta">
                Sent {formatWhen(r.createdAt)}
                {r.status === "rejected" ? " · Declined" : r.result?.verifiedAt ? ` · Answered ${formatWhen(r.result.verifiedAt)}` : ` · Expires ${formatWhen(r.expiresAt)}`}
              </p>
              {links[r.id] && r.status !== "verified" && (
                <p className="meta"><a href={links[r.id]} target="_blank" rel="noreferrer">Open tenant link</a></p>
              )}
            </div>
            <Status r={r} />
          </article>
        ))}
      </div>
    </main>
  );
}

function questionLine(multiple: number, rent: number) {
  const multipleText = Number.isFinite(multiple) && multiple > 0 ? String(multiple) : "—";
  const rentText = Number.isFinite(rent) && rent > 0 ? rent.toLocaleString("en-US") : "—";
  return `Is income at least ${multipleText}× a $${rentText} monthly rent?`;
}

function formatWhen(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(t);
}

function Status({ r }: { r: VerificationRequest }) {
  if (r.status === "rejected") {
    return (
      <div role="status">
        <p className="verdict declined">Declined</p>
        <p className="meta">Nothing financial was shared.</p>
      </div>
    );
  }
  if (r.status === "verified" && r.result) {
    const evidence = r.result.evidence ?? "bank";
    return (
      <div role="status">
        {r.result.answer
          ? <p className="verdict ok">Yes — meets the requirement</p>
          : <p className="verdict bad">No — does not meet the requirement</p>}
        <p className={evidence === "document_unverified" ? "meta evidence weak" : "meta evidence"}>{EVIDENCE_LABELS[evidence]}</p>
      </div>
    );
  }
  return <p className="verdict wait" role="status">Waiting for the tenant</p>;
}
