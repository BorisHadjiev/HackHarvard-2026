// Accuracy report for on-device document reading (Chalk challenge). Generates a labeled corpus of
// genuine and forged documents (PDF and photo), runs the real pipeline, and scores it.
//   npm run doc-accuracy              writes docs/document-accuracy.md
//   npm run doc-accuracy -- --people 30
import { writeFileSync } from "node:fs";
import { analyzeFile, analyzeIdDocuments, decideAge } from "../tenant-app/lib/documents/analyze";
import { stopOcr } from "../tenant-app/lib/documents/ocr";
import type { Deposit } from "../tenant-app/lib/nessie";
import type { DocumentReport } from "../tenant-app/lib/documents/types";
import {
  ageSpecimens, f1040Rows, form1040, payStub, payStubRows, rowsToImage, rowsToPdf, statementRows, w2, w2Rows,
  type Layout, type PayStubData, type Row, type StatementData,
} from "./lib/sample-documents";

const people = Number(process.argv[process.argv.indexOf("--people") + 1]) || 16;
const now = new Date("2026-10-17T12:00:00Z");

// Seeded randomness so the report is reproducible (simulation only, not cryptography).
let seed = 20261017;
const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const between = (a: number, b: number) => a + rand() * (b - a);
const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(now.getTime() - n * 86_400_000);

const EMPLOYERS = ["Acme Corp Payroll", "Bean There Cafe Payroll", "Northwind Logistics", "Contoso Health", "Fabrikam Studios", "Globex Retail", "Initech Services", "Umbrella Clinics"];
const NAMES = ["Maya Patel", "Leo Okafor", "Ana Souza", "Kenji Mori", "Priya Shah", "Sam Rivera", "Noor Haddad", "Jonas Berg"];
const FREQ = ["weekly", "biweekly", "biweekly", "semimonthly", "monthly"] as const;
const GAP = { weekly: 7, biweekly: 14, semimonthly: 15, monthly: 30 } as const;
const PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 } as const;

type Case = {
  label: string; group: "genuine" | "forged"; forgery?: string; kind: string; medium: "pdf" | "photo";
  file: { name: string; type: string; data: Uint8Array }; bank: Deposit[];
  truth: { fields: Record<string, number | string>; monthly: number };
};

const cases: Case[] = [];
const pdf = (name: string, rows: Row[], meta?: Parameters<typeof rowsToPdf>[1]) => rowsToPdf(rows, meta).then((data) => ({ name, type: "application/pdf", data }));
const photo = (name: string, rows: Row[]) => rowsToImage(rows, { rotate: between(-1.2, 1.2), blur: between(0, 0.7), jpegQuality: Math.round(between(60, 90)) }).then((data) => ({ name, type: "image/jpeg", data }));

for (let i = 0; i < people; i++) {
  const employer = pick(EMPLOYERS);
  const name = pick(NAMES);
  const frequency = pick(FREQ);
  const layout = Math.floor(rand() * 3) as Layout;
  const gross = r2(between(1100, 7200) * (frequency === "weekly" ? 0.5 : frequency === "monthly" ? 2 : 1));
  const payDate = daysAgo(Math.floor(between(1, 12)));
  const stub = payStub({ employer, employee: name, payDate, frequency, gross, taxRate: between(0.18, 0.32) });
  const monthly = r2((stub.gross * PER_YEAR[frequency]) / 12);

  // The bank: this person's net pay every pay period for 90 days, plus a little noise.
  const bank: Deposit[] = [];
  for (let t = Date.parse(payDate); t > now.getTime() - 90 * 86_400_000; t -= GAP[frequency] * 86_400_000) {
    bank.push({ id: `${i}-${t}`, payer: employer, amount: stub.net, date: iso(t) });
  }
  bank.push({ id: `${i}-refund`, payer: "Card refund", amount: r2(between(5, 80)), date: daysAgo(20) });

  const stubTruth = { fields: { grossPay: stub.gross, netPay: stub.net, payDate }, monthly };
  cases.push({ label: "pay stub", group: "genuine", kind: "pay_stub", medium: "pdf", file: await pdf(`stub-${i}.pdf`, payStubRows(stub, layout)), bank, truth: stubTruth });
  cases.push({ label: "pay stub", group: "genuine", kind: "pay_stub", medium: "photo", file: await photo(`stub-${i}.jpg`, payStubRows(stub, layout)), bank, truth: stubTruth });

  const crude: PayStubData = { ...stub, gross: r2(stub.gross * between(1.3, 1.6)) };
  cases.push({ label: "pay stub", group: "forged", forgery: "gross raised only", kind: "pay_stub", medium: "pdf", file: await pdf(`stub-crude-${i}.pdf`, payStubRows(crude, layout)), bank, truth: stubTruth });
  cases.push({ label: "pay stub", group: "forged", forgery: "gross raised only", kind: "pay_stub", medium: "photo", file: await photo(`stub-crude-${i}.jpg`, payStubRows(crude, layout)), bank, truth: stubTruth });
  const careful = payStub({ employer, employee: name, payDate, frequency, gross: r2(stub.gross * between(1.3, 1.6)) });
  cases.push({ label: "pay stub", group: "forged", forgery: "gross and net raised consistently", kind: "pay_stub", medium: "pdf", file: await pdf(`stub-careful-${i}.pdf`, payStubRows(careful, layout)), bank, truth: stubTruth });

  // A statement covering the last 30 days.
  const deposits = bank.filter((d) => d.date >= daysAgo(30) && d.date <= daysAgo(2) && d.payer === employer).map((d) => ({ date: d.date, desc: `${employer.toUpperCase()} PPD`, amount: d.amount }));
  const statement: StatementData = {
    bank: "Northwind Community Bank", holder: name, periodStart: daysAgo(30), periodEnd: daysAgo(2), opening: r2(between(200, 5000)), deposits,
    withdrawals: Array.from({ length: 4 }, (_, k) => ({ date: daysAgo(28 - k * 6), desc: pick(["GROCERY MART", "CITY POWER", "RENT", "PHARMACY", "TRANSIT"]), amount: r2(between(20, 900)) })),
  };
  if (deposits.length) {
    const stTruth = { fields: { deposits: deposits.length }, monthly: r2(deposits.reduce((s, d) => s + d.amount, 0) / (29 / 30.44)) };
    cases.push({ label: "bank statement", group: "genuine", kind: "bank_statement", medium: "pdf", file: await pdf(`statement-${i}.pdf`, statementRows(statement, layout)), bank, truth: stTruth });
    const raisedDeps = deposits.map((d, k) => (k === 0 ? { ...d, amount: r2(d.amount * 2) } : d));
    const total = r2(deposits.reduce((s, d) => s + d.amount, 0));
    cases.push({ label: "bank statement", group: "forged", forgery: "deposit raised, totals not fixed", kind: "bank_statement", medium: "pdf", file: await pdf(`statement-crude-${i}.pdf`, statementRows({ ...statement, deposits: raisedDeps, statedDepositTotal: total }, layout)), bank, truth: stTruth });
    cases.push({ label: "bank statement", group: "forged", forgery: "deposit raised, totals fixed", kind: "bank_statement", medium: "pdf", file: await pdf(`statement-careful-${i}.pdf`, statementRows({ ...statement, deposits: raisedDeps }, layout)), bank, truth: stTruth });
  }

  // Last year's tax forms.
  const wages = r2(stub.gross * PER_YEAR[frequency] * between(0.9, 1.0));
  const form = w2({ taxYear: 2025, employer: employer.replace(" Payroll", ""), employee: name, wages, pretax: r2(wages * between(0, 0.06)) });
  const ret = form1040({ taxYear: 2025, name, wages: form.box1, other: Math.round(between(0, 900)), adjustments: Math.round(between(0, 2500)) });
  cases.push({ label: "W-2", group: "genuine", kind: "w2", medium: "pdf", file: await pdf(`w2-${i}.pdf`, w2Rows(form)), bank, truth: { fields: { box1: form.box1 }, monthly: r2(form.box1 / 12) } });
  cases.push({ label: "W-2", group: "genuine", kind: "w2", medium: "photo", file: await photo(`w2-${i}.jpg`, w2Rows(form)), bank, truth: { fields: { box1: form.box1 }, monthly: r2(form.box1 / 12) } });
  const inflated = { ...form, box1: r2(form.box1 * 1.5), box3: Math.min(176100, r2(form.box3 * 1.5)), box5: r2(form.box5 * 1.5) };
  cases.push({ label: "W-2", group: "forged", forgery: "wages raised, taxes not", kind: "w2", medium: "pdf", file: await pdf(`w2-forged-${i}.pdf`, w2Rows(inflated)), bank, truth: { fields: {}, monthly: 0 } });
  cases.push({ label: "Form 1040", group: "genuine", kind: "form_1040", medium: "pdf", file: await pdf(`1040-${i}.pdf`, f1040Rows(ret)), bank, truth: { fields: { line11: ret.l11 }, monthly: r2(ret.l11 / 12) } });
  cases.push({ label: "Form 1040", group: "forged", forgery: "AGI raised only", kind: "form_1040", medium: "pdf", file: await pdf(`1040-forged-${i}.pdf`, f1040Rows({ ...ret, l11: ret.l11 + 30000 })), bank, truth: { fields: {}, monthly: 0 } });
}

type Result = { c: Case; withBank: DocumentReport; noBank: DocumentReport };
const results: Result[] = [];
const started = Date.now();
for (const c of cases) {
  const withBank = await analyzeFile(c.file, { bank: { deposits: c.bank, source: "synthetic" }, now, trusted: [] });
  const noBank = await analyzeFile(c.file, { now, trusted: [] });
  results.push({ c, withBank, noBank });
}
const ageResults = [];
for (const specimen of await ageSpecimens(now)) {
  const decision = decideAge(await analyzeIdDocuments([specimen], now), 18, now);
  ageResults.push({ specimen, decision });
}
await stopOcr();
const seconds = ((Date.now() - started) / 1000).toFixed(0);

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");
const lines: string[] = [];
const row = (...cells: (string | number)[]) => lines.push(`| ${cells.join(" | ")} |`);

lines.push("# Document reading accuracy", "");
lines.push(`Generated by \`npm run doc-accuracy\` on a synthetic, labeled corpus: ${people} people, ${cases.length} documents (${cases.filter((c) => c.medium === "photo").length} photos with tilt, blur and JPEG compression). Every document runs through the same on-device pipeline the tenant app uses. Took ${seconds}s.`, "");
lines.push("Synthetic documents use our own layouts, so these numbers measure the pipeline, not every real-world format. Real statements vary more.", "");

lines.push("## Reading genuine documents", "");
row("Document", "Medium", "Count", "Recognized type", "Key fields exact", "Income within 0.5%", "Accepted (with bank)");
row("---", "---", "---:", "---:", "---:", "---:", "---:");
const genuine = results.filter((r) => r.c.group === "genuine");
for (const label of ["pay stub", "bank statement", "W-2", "Form 1040"]) {
  for (const medium of ["pdf", "photo"] as const) {
    const set = genuine.filter((r) => r.c.label === label && r.c.medium === medium);
    if (!set.length) continue;
    const kindOk = set.filter((r) => r.withBank.kind === r.c.kind).length;
    const fieldsOk = set.filter((r) => Object.entries(r.c.truth.fields).every(([k, v]) => r.withBank.fields[k] === v)).length;
    const incomeOk = set.filter((r) => r.withBank.monthlyIncome !== undefined && Math.abs(r.withBank.monthlyIncome - r.c.truth.monthly) <= r.c.truth.monthly * 0.005).length;
    const accepted = set.filter((r) => r.withBank.usable).length;
    row(label, medium === "pdf" ? "PDF" : "Photo", set.length, pct(kindOk, set.length), pct(fieldsOk, set.length), pct(incomeOk, set.length), pct(accepted, set.length));
  }
}
lines.push("");
lines.push("## Catching forgeries", "");
lines.push("A forgery is caught when the document is rejected (not used toward the answer).", "");
row("Document", "Forgery", "Medium", "Count", "Caught with bank", "Caught without bank");
row("---", "---", "---", "---:", "---:", "---:");
const forged = results.filter((r) => r.c.group === "forged");
const groups = new Map<string, Result[]>();
for (const r of forged) {
  const k = `${r.c.label}|${r.c.forgery}|${r.c.medium}`;
  groups.set(k, [...(groups.get(k) ?? []), r]);
}
for (const [k, set] of groups) {
  const [label, forgery, medium] = k.split("|");
  row(label, forgery, medium === "pdf" ? "PDF" : "Photo", set.length, pct(set.filter((r) => !r.withBank.usable).length, set.length), pct(set.filter((r) => !r.noBank.usable).length, set.length));
}
const fp = genuine.filter((r) => !r.withBank.usable);
lines.push("");
lines.push(`False rejections: ${fp.length} of ${genuine.length} genuine documents (${pct(fp.length, genuine.length)}).`);
if (fp.length) {
  lines.push("", "Why genuine documents were rejected:", "");
  for (const r of fp.slice(0, 12)) lines.push(`- ${r.c.file.name}: ${r.withBank.checks.filter((c) => c.status === "fail").map((c) => c.label).join("; ")}`);
}
lines.push("", "## Age accuracy (separate specimen corpus)", "");
lines.push("Seven visibly fictional images run through the real offline barcode/OCR reader. Expected outcomes distinguish a verified no from an unreadable/expired/edited ID decline. These results do not measure issuer authenticity or real-world fraud detection.", "");
row("Specimen", "Expected", "Observed", "Correct");
row("---", "---", "---", "---");
const outcome = (d: { usable: boolean; meets: boolean }) => !d.usable ? "declined" : d.meets ? "yes" : "no";
let ageCorrect = 0;
for (const { specimen, decision } of ageResults) {
  const correct = outcome(specimen.expected) === outcome(decision);
  if (correct) ageCorrect++;
  row(specimen.name, outcome(specimen.expected), outcome(decision), correct ? "yes" : "NO");
}
lines.push("", `Age outcomes correct: ${ageCorrect}/${ageResults.length} (${pct(ageCorrect, ageResults.length)}).`);
if (ageCorrect !== ageResults.length) process.exitCode = 1;
// Preserve the existing income baseline: genuine documents must still all be accepted,
// and every seeded forgery must be caught when the bank is available.
if (fp.length || forged.some(r => r.withBank.usable)) process.exitCode = 1;
lines.push("", "## What this does not prove", "");
lines.push("- A careful forgery with consistent totals is only caught when the bank's own records contradict it. Without a bank connection it counts as \"documents only, not independently verified\", and the landlord sees that label.");
lines.push("- Tax forms cover a past year, so the bank check is a plausibility check, not an exact match.");
lines.push("- Signed PDFs are covered by unit tests (valid, untrusted, and changed after signing), not by this corpus.");

const report = lines.join("\n") + "\n";
writeFileSync("docs/document-accuracy.md", report);
console.log(report);
