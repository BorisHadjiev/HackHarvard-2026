"use client";
// How the tenant proves the answer: bank data (demo account or Plaid) or income documents
// checked on this device. Owner: Sam (logic), styled with Boris's classes.
import { useState } from "react";

export type Mode = "bank" | "documents";

type Check = { id: string; status: "pass" | "warn" | "fail" | "info"; label: string };
export type DocSummary = {
  fileName: string; kind: string; issuer?: string; date?: string; monthlyIncome?: number;
  readMethod: string; bankMatch: string; signature: string; usable: boolean; counted: boolean; checks: Check[];
};
export type Decision = { monthlyIncome: number; meets: boolean; strength: string | null; reason?: string; documents: DocSummary[]; bankSource?: string | null; bankError?: string | null };

export const STRENGTH_LABELS: Record<string, string> = {
  bank: "Bank-verified",
  document_signed: "Signed documents",
  document_bank_matched: "Documents confirmed by your bank",
  document_unverified: "Documents only, not independently verified",
};

const ICON: Record<Check["status"], string> = { pass: "✓", warn: "!", fail: "✗", info: "·" };
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

declare global {
  interface Window {
    Plaid?: { create(o: { token: string; onSuccess: (publicToken: string, meta: { institution?: { name?: string } | null }) => void; onExit?: () => void }): { open(): void } };
  }
}

function loadPlaidScript(): Promise<void> {
  if (window.Plaid) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load Plaid Link"));
    document.head.appendChild(s);
  });
}

export function DocumentReport({ decision }: { decision: Decision }) {
  return (
    <div className="card private field-last" role="status">
      <p className="kicker">Only on this device — not sent</p>
      {decision.strength ? (
        <p><b>Evidence level:</b> {STRENGTH_LABELS[decision.strength]}. Gross monthly income from the documents: <b>{usd(decision.monthlyIncome)}</b>.</p>
      ) : (
        <p className="banner bad">No answer from these documents: {decision.reason}.</p>
      )}
      {decision.bankError && <p className="hint">Couldn&apos;t reach your bank data to confirm them ({decision.bankError}).</p>}
      <ul className="plain doc-list">
        {decision.documents.map((d) => (
          <li key={d.fileName} className="doc">
            <p className="doc-title">
              <b>{d.kind}</b>{d.issuer ? ` · ${d.issuer}` : ""}{d.date ? ` · ${d.date}` : ""}
              <span className={d.counted ? "pill ok" : d.usable ? "pill" : "pill bad"}>{d.counted ? "Counts" : d.usable ? "Not needed" : "Not used"}</span>
            </p>
            {!d.usable && <p className="banner bad">{d.checks.find((c) => c.status === "fail")?.label}</p>}
            <p className="hint">{d.fileName}{d.monthlyIncome ? ` · supports ${usd(d.monthlyIncome)}/month` : ""}</p>
            <ul className="plain checks">
              {d.checks.map((c, i) => <li key={c.id + i} className={`check ${c.status}`}><span aria-hidden>{ICON[c.status]}</span> {c.label}</li>)}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function EvidencePicker(props: {
  mode: Mode; setMode: (m: Mode) => void;
  tenants: Record<string, string>; tenant: string; setTenant: (t: string) => void;
  plaidConfigured: boolean; plaidLinkId: string | null; setPlaidLinkId: (id: string | null) => void;
  files: File[]; setFiles: (f: File[]) => void;
  confirmWithBank: boolean; setConfirmWithBank: (v: boolean) => void;
  rent: number; multiple: number; disabled: boolean;
}) {
  const [institution, setInstitution] = useState<string | null>(null);
  const [plaidError, setPlaidError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<Decision | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  async function connectBank() {
    setPlaidError(null);
    try {
      const res = await fetch("/api/plaid/link-token", { method: "POST" });
      const body = (await res.json()) as { configured: boolean; linkToken?: string; error?: string };
      if (!body.linkToken) throw new Error(body.error ?? "Plaid isn't set up on this device");
      await loadPlaidScript();
      window.Plaid!.create({
        token: body.linkToken,
        onSuccess: async (publicToken, meta) => {
          const ex = await fetch("/api/plaid/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicToken, institution: meta.institution?.name }) });
          const out = (await ex.json()) as { linkId?: string; institution?: string | null; error?: string };
          if (!out.linkId) { setPlaidError(out.error ?? "Couldn't finish connecting"); return; }
          props.setPlaidLinkId(out.linkId);
          setInstitution(out.institution ?? "your bank");
        },
      }).open();
    } catch (err) {
      setPlaidError((err as Error).message);
    }
  }

  async function checkDocuments() {
    setChecking(true);
    setPreview(null);
    setPreviewError(null);
    try {
      const form = new FormData();
      for (const f of props.files) form.append("documents", f);
      form.set("tenant", props.tenant);
      if (props.plaidLinkId) form.set("plaidLinkId", props.plaidLinkId);
      form.set("confirmWithBank", String(props.confirmWithBank));
      form.set("rent", String(props.rent));
      form.set("multiple", String(props.multiple));
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Check failed");
      setPreview(body as Decision);
    } catch (err) {
      setPreviewError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }

  const bankPicker = (
    <>
      <label htmlFor="demo-account">
        {props.mode === "documents" ? "Bank data to confirm against" : "Demo bank account"}
        <select id="demo-account" value={props.tenant} onChange={(e) => props.setTenant(e.target.value)} disabled={props.disabled || !!props.plaidLinkId}>
          {Object.entries(props.tenants).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <span className="hint">{props.plaidLinkId ? `Using ${institution ?? "your connected bank"} instead.` : "Sample accounts for the demo. Maya meets a typical 3× rule. Leo does not."}</span>
      </label>
      {props.plaidConfigured && (
        <div className="actions">
          {props.plaidLinkId
            ? <button type="button" className="secondary" onClick={() => { props.setPlaidLinkId(null); setInstitution(null); }} disabled={props.disabled}>Disconnect {institution ?? "bank"}</button>
            : <button type="button" className="secondary" onClick={connectBank} disabled={props.disabled}>Connect your bank (Plaid)</button>}
        </div>
      )}
      {props.plaidConfigured && !props.plaidLinkId && <p className="hint">Plaid sandbox test login: user_good / pass_good.</p>}
      {plaidError && <p className="banner bad" role="alert">{plaidError}</p>}
    </>
  );

  return (
    <>
      <fieldset className="modes" disabled={props.disabled}>
        <legend>How should this device check?</legend>
        <label className={props.mode === "bank" ? "mode on" : "mode"}>
          <input type="radio" name="mode" checked={props.mode === "bank"} onChange={() => props.setMode("bank")} />
          <span><b>Bank data</b> — strongest. Deposits come straight from your bank.</span>
        </label>
        <label className={props.mode === "documents" ? "mode on" : "mode"}>
          <input type="radio" name="mode" checked={props.mode === "documents"} onChange={() => props.setMode("documents")} />
          <span><b>Income documents</b> — pay stubs, bank statements, W-2 or Form 1040. Read and checked here, never uploaded.</span>
        </label>
      </fieldset>

      {props.mode === "bank" && bankPicker}

      {props.mode === "documents" && (
        <>
          <label htmlFor="documents">
            Documents (PDF or photo)
            <input id="documents" type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" disabled={props.disabled}
              onChange={(e) => { props.setFiles([...(e.target.files ?? [])].slice(0, 6)); setPreview(null); }} />
            <span className="hint">Up to 6 files, 10 MB each. Photos work, but a scan or photo alone can be edited, so it counts as the weakest evidence unless your bank or a digital signature confirms it.</span>
          </label>
          <label className="inline">
            <input type="checkbox" checked={props.confirmWithBank} onChange={(e) => { props.setConfirmWithBank(e.target.checked); setPreview(null); }} disabled={props.disabled} />
            Confirm the documents against my bank data
          </label>
          {props.confirmWithBank && bankPicker}
          <div className="actions">
            <button type="button" className="secondary" onClick={checkDocuments} disabled={props.disabled || checking || !props.files.length}>
              {checking ? "Reading documents on this device…" : "Check documents first"}
            </button>
          </div>
          {previewError && <p className="banner bad" role="alert">{previewError}</p>}
          {preview && <DocumentReport decision={preview} />}
        </>
      )}
    </>
  );
}
