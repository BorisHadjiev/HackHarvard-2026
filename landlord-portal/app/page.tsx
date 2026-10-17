"use client";
// Landlord portal home. Owner: Boris (UI).
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { EVIDENCE_LABELS, type VerificationRequest } from "@ntk/shared";
import { landlordVerdict } from "@/lib/verdict";

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
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
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

  const deliveryNote = !share
    ? null
    : delivery === "sent"
      ? "Text sent to the tenant."
      : phone.trim()
        ? "Photon is not configured, so this link was only logged. Share it yourself."
        : "No phone number on this request. Share the link.";

  const pending = requests.filter((r) => r.status === "pending" && Date.parse(r.expiresAt) > Date.now()).length;
  const verified = requests.filter((r) => r.status === "verified").length;
  const visible = requests.filter((r) => {
    const status = r.status === "pending" && Date.parse(r.expiresAt) <= Date.now() ? "expired" : r.status;
    return (filter === "all" || status === filter) && (r.id + " " + r.requesterName + " " + r.question.rent).toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="workspace">
      <aside className="sidebar">
        <p className="kicker">Your workspace</p>
        <h2>Landlord portal</h2>
        <nav aria-label="Workspace"><a className="nav-active" href="/">Verification requests <span>↗</span></a><a href="/unlinkability">How privacy works <span>↗</span></a></nav>
        <div className="sidebar-note"><span className="seal small" aria-hidden="true">✓</span><h3>Just what you need.</h3><p>One eligibility answer. No statements, balances, or private income amounts.</p></div>
        <p className="sidebar-footer">Need-to-Know<br/>Built for privacy. Designed for people.</p>
      </aside>
      <main className="dashboard">
        <header className="page-head"><div><p className="kicker">Your rental workspace</p><h1>Verification requests</h1><p className="sub">A little certainty. A lot less paperwork.</p></div><a className="button" href="#new-request">＋ New request</a></header>
        <section className="stats" aria-label="Request summary"><div><span>Awaiting tenant</span><strong>{pending}</strong><small>Private links open</small></div><div><span>Verified results</span><strong>{verified}</strong><small>Signed yes / no answers</small></div><div><span>Total requests</span><strong>{requests.length}</strong><small>Every result scoped to a request</small></div></section>
        <div className="privacy-strip"><span aria-hidden="true">✓</span><b>Privacy comes standard</b><span>No bank documents. No income amounts. Just the answer.</span></div>
        <div className="dashboard-grid">
          <section className="card request-list" aria-labelledby="requests-heading">
            <div className="section-head"><h2 id="requests-heading">All requests <span className="count">{requests.length}</span></h2><span className="live-dot">Updates live</span></div>
            <label className="search-label"><span className="sr-only">Search requests</span><input placeholder="Search by request ID or rent…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
            <div className="filters" aria-label="Filter requests">{[["all", "All"], ["pending", "Awaiting tenant"], ["verified", "Verified"], ["rejected", "Declined"], ["expired", "Expired"]].map(([value, label]) => <button type="button" className={filter === value ? "filter active" : "filter"} aria-pressed={filter === value} onClick={() => setFilter(value)} key={value}>{label}</button>)}</div>
            {!loaded && <p className="empty">Loading requests…</p>}
            {loadError && <p className="banner bad" role="alert">{loadError}</p>}
            {loaded && !loadError && visible.length === 0 && <div className="empty-state"><span className="seal small" aria-hidden="true">✓</span><h3>{requests.length ? "No matching requests" : "Your first answer starts here"}</h3><p>{requests.length ? "Try another filter or search." : "Create a request. The tenant chooses what to share."}</p></div>}
            <div aria-live="polite">{visible.map((r) => <article className="request-row" key={r.id}><div className="request-mark" aria-hidden="true">↗</div><div className="request-info"><h3>Income eligibility check</h3><p className="meta">Rent ${r.question.rent.toLocaleString("en-US")} / month · {r.question.multiple}× requirement</p><p className="mono">{r.id}</p><details><summary>Request details</summary><p className="meta">{questionLine(r.question.multiple, r.question.rent)}</p><p className="meta">Sent {formatWhen(r.createdAt)} · Expires {formatWhen(r.expiresAt)}</p>{r.result && <p className="meta">Verified {formatWhen(r.result.verifiedAt)}. No private financial evidence received.</p>}{links[r.id] && r.status === "pending" && <a href={links[r.id]} target="_blank" rel="noreferrer">Open tenant consent ↗</a>}</details></div><Status r={r} /></article>)}</div>
            <p className="list-foot">Your rent requirement is public. The tenant’s financial evidence stays private.</p>
          </section>
          <div>
            <form id="new-request" className="card form-card" onSubmit={create}>
              <p className="kicker">A simple, private check</p><h2>New verification request</h2><p className="hint gap">Ask whether income meets your rent requirement.</p>
              <label>Monthly rent ($)<input type="number" min="1" step="1" required value={rent} onChange={(e) => setRent(e.target.value)} aria-label="Monthly rent in dollars" /></label>
              <label>Required income multiple<input type="number" min="0.1" step="any" required value={multiple} onChange={(e) => setMultiple(e.target.value)} aria-label="Required income multiple" /></label>
              <div className="threshold"><span>Requirement · set by you</span><strong>${Number.isFinite(Number(rent) * Number(multiple)) ? (Number(rent) * Number(multiple)).toLocaleString("en-US") : "—"}<small> / month</small></strong><p>Calculated from rent. This is not the tenant’s income.</p></div>
              <label>Tenant phone <span className="optional">optional</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 617 555 0123" inputMode="tel" autoComplete="tel" /><span className="hint">Send a text when messaging is connected, or share the link yourself.</span></label>
              {formError && <p className="banner bad" role="alert">{formError}</p>}
              <button className="full" disabled={busy}>{busy ? "Creating…" : "Send verification request →"}</button><p className="hint form-note">The tenant reviews and approves before anything is shared.</p>
            </form>
            {share && <section className="card current" aria-labelledby="share-title"><p className="kicker">Request ready</p><h2 id="share-title">Let the tenant take it from here.</h2><p className="hint gap-sm">{deliveryNote}</p><div className="actions"><a className="button" href={share.link} target="_blank" rel="noreferrer">Open tenant consent ↗</a><button type="button" className="secondary" onClick={copyLink}>{copied ? "Copied ✓" : "Copy link"}</button></div>{copyError && <p className="banner bad" role="alert">{copyError}</p>}<label className="field-last">Tenant link<input readOnly value={share.link} onFocus={(e) => e.currentTarget.select()} /></label></section>}
          </div>
        </div>
        <footer className="page-footer">Need-to-Know · A signed answer, without the paperwork.</footer>
      </main>
    </div>
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
  const label = landlordVerdict(r);
  if (label === "Declined") {
    const evidence = r.result?.evidence;
    return (
      <div role="status">
        <p className="verdict declined">Declined</p>
        {r.status === "verified" && evidence
          ? <p className={evidence === "document_unverified" ? "meta evidence weak" : "meta evidence"}>{EVIDENCE_LABELS[evidence]}</p>
          : <p className="meta">Nothing financial was shared.</p>}
      </div>
    );
  }
  if (r.status === "verified" && r.result) {
    const evidence = r.result.evidence ?? "bank";
    return (
      <div role="status">
        <p className={r.result.answer ? "verdict ok" : "verdict bad"}>{label}</p>
        <p className={evidence === "document_unverified" ? "meta evidence weak" : "meta evidence"}>{EVIDENCE_LABELS[evidence]}</p>
      </div>
    );
  }
  return <p className="verdict wait" role="status">{label}</p>;
}
