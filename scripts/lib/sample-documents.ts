// Synthetic income documents for tests, the demo and the accuracy report. Every document says
// "SAMPLE" and uses fictional employers and banks. Owner: Sam.
import { generateKeyPairSync } from "node:crypto";
import forge from "node-forge";
import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import { fixtureDeposits } from "../../tenant-app/lib/nessie";
import { plainAddPlaceholder } from "@signpdf/placeholder-plain";
import { P12Signer } from "@signpdf/signer-p12";
import signpdfModule from "@signpdf/signpdf";

export type Cell = { text: string; x: number };
export type Row = Cell[];
export type Layout = 0 | 1 | 2;

const usd = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = (n: number) => Math.round(n).toLocaleString("en-US");
const r2 = (n: number) => Math.round(n * 100) / 100;

function fmtDate(iso: string, layout: Layout): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (layout === 1) return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (layout === 2) return iso;
  return `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`;
}
const row = (...cells: [string, number][]): Row => cells.map(([text, x]) => ({ text, x }));

// ------------------------------------------------------------------ data

export interface PayStubData {
  employer: string; employee: string; payDate: string; periodStart: string; periodEnd: string;
  frequency: "weekly" | "biweekly" | "semimonthly" | "monthly";
  gross: number; deductions: number; net: number; grossYtd: number; deductionsYtd: number; netYtd: number;
}
export interface StatementTx { date: string; desc: string; amount: number }
export interface StatementData {
  bank: string; holder: string; periodStart: string; periodEnd: string; opening: number;
  deposits: StatementTx[]; withdrawals: StatementTx[];
  /** Override totals (forgeries that don't fix their sums). */
  statedDepositTotal?: number; statedClosing?: number;
}
export interface W2Data { taxYear: number; employer: string; employee: string; box1: number; box2: number; box3: number; box4: number; box5: number; box6: number }
export interface F1040Data { taxYear: number; name: string; l1z: number; l9: number; l10: number; l11: number; l12: number; l14: number; l15: number }

const PERIODS = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 } as const;

export function payStub(o: { employer: string; employee: string; payDate: string; frequency?: PayStubData["frequency"]; gross: number; taxRate?: number }): PayStubData {
  const frequency = o.frequency ?? "biweekly";
  const days = frequency === "weekly" ? 7 : frequency === "biweekly" ? 14 : frequency === "semimonthly" ? 15 : 30;
  const end = new Date(Date.parse(o.payDate) - 3 * 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const deductions = r2(o.gross * (o.taxRate ?? 0.27));
  const net = r2(o.gross - deductions);
  const dayOfYear = Math.floor((Date.parse(o.payDate) - Date.parse(`${o.payDate.slice(0, 4)}-01-01`)) / 86_400_000) + 1;
  const periods = Math.max(1, Math.round((dayOfYear / 365) * PERIODS[frequency]));
  return {
    employer: o.employer, employee: o.employee, payDate: o.payDate, frequency, gross: o.gross, deductions, net,
    periodStart: start.toISOString().slice(0, 10), periodEnd: end.toISOString().slice(0, 10),
    grossYtd: r2(o.gross * periods), deductionsYtd: r2(deductions * periods), netYtd: r2(net * periods),
  };
}

export function w2(o: { taxYear: number; employer: string; employee: string; wages: number; pretax?: number }): W2Data {
  const box3 = Math.min(o.wages, 176100);
  const box1 = r2(o.wages - (o.pretax ?? 0));
  return { taxYear: o.taxYear, employer: o.employer, employee: o.employee, box1, box2: r2(box1 * 0.14), box3, box4: r2(box3 * 0.062), box5: o.wages, box6: r2(o.wages * 0.0145) };
}

export function form1040(o: { taxYear: number; name: string; wages: number; other?: number; adjustments?: number }): F1040Data {
  const l9 = Math.round(o.wages + (o.other ?? 0));
  const l10 = Math.round(o.adjustments ?? 0);
  const l11 = l9 - l10;
  const l12 = 15000;
  return { taxYear: o.taxYear, name: o.name, l1z: Math.round(o.wages), l9, l10, l11, l12, l14: l12, l15: Math.max(0, l11 - l12) };
}

// ------------------------------------------------------------------ rows (one per printed line)

export function payStubRows(d: PayStubData, layout: Layout = 0): Row[] {
  const grossLabel = ["Gross Pay", "Gross Earnings", "Gross Wages"][layout];
  const dedLabel = ["Total Deductions", "Total Taxes & Deductions", "Total Withholdings"][layout];
  const freq = { weekly: "Weekly", biweekly: ["Biweekly", "Bi-Weekly", "Every two weeks"][layout], semimonthly: "Semi-Monthly", monthly: "Monthly" }[d.frequency];
  return [
    row([["Earnings Statement", "Pay Stub", "Pay Statement"][layout], 40], ["SAMPLE - TEST DATA", 400]),
    row([`Employer: ${d.employer}`, 40]),
    row([`Employee: ${d.employee}`, 40]),
    row([`Pay Date: ${fmtDate(d.payDate, layout)}`, 40], [`Pay Frequency: ${freq}`, 330]),
    row([`Pay Period: ${fmtDate(d.periodStart, layout)} - ${fmtDate(d.periodEnd, layout)}`, 40]),
    row(["", 40]),
    row(["Description", 40], ["Current", 330], ["Year to Date", 450]),
    row([grossLabel, 40], [usd(d.gross), 330], [usd(d.grossYtd), 450]),
    row(["Federal Income Tax", 60], [usd(r2(d.deductions * 0.5)), 330], [usd(r2(d.deductionsYtd * 0.5)), 450]),
    row(["Social Security", 60], [usd(r2(d.deductions * 0.23)), 330], [usd(r2(d.deductionsYtd * 0.23)), 450]),
    row(["Medicare", 60], [usd(r2(d.deductions * 0.05)), 330], [usd(r2(d.deductionsYtd * 0.05)), 450]),
    row(["State Income Tax", 60], [usd(r2(d.deductions - r2(d.deductions * 0.5) - r2(d.deductions * 0.23) - r2(d.deductions * 0.05))), 330], [usd(r2(d.deductionsYtd - r2(d.deductionsYtd * 0.5) - r2(d.deductionsYtd * 0.23) - r2(d.deductionsYtd * 0.05))), 450]),
    row([dedLabel, 40], [usd(d.deductions), 330], [usd(d.deductionsYtd), 450]),
    row(["Net Pay", 40], [usd(d.net), 330], [usd(d.netYtd), 450]),
  ];
}

export function statementRows(d: StatementData, layout: Layout = 0): Row[] {
  const depTotal = r2(d.deposits.reduce((s, t) => s + t.amount, 0));
  const wdTotal = r2(d.withdrawals.reduce((s, t) => s + t.amount, 0));
  const closing = d.statedClosing ?? r2(d.opening + depTotal - wdTotal);
  const short = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
  const tx = (t: StatementTx) => row([short(t.date), 40], [t.desc, 100], [usd(t.amount), 470]);
  return [
    row([d.bank, 40], ["SAMPLE - TEST DATA", 400]),
    row([["Account Statement", "Checking Account Statement", "Monthly Statement"][layout], 40]),
    row([`Account Holder: ${d.holder}`, 40]),
    row([`Statement Period: ${fmtDate(d.periodStart, layout)} - ${fmtDate(d.periodEnd, layout)}`, 40]),
    row(["", 40]),
    row([["Beginning Balance", "Opening Balance", "Previous Balance"][layout], 40], [usd(d.opening), 470]),
    row([["Total Deposits", "Total Deposits and Additions", "Total Credits"][layout], 40], [usd(d.statedDepositTotal ?? depTotal), 470]),
    row([["Total Withdrawals", "Total Withdrawals and Debits", "Total Debits"][layout], 40], [usd(wdTotal), 470]),
    row([["Ending Balance", "Closing Balance", "New Balance"][layout], 40], [usd(closing), 470]),
    row(["", 40]),
    row([["Deposits", "Deposits and Additions", "Credits"][layout], 40]),
    ...d.deposits.map(tx),
    row(["", 40]),
    row([["Withdrawals", "Withdrawals and Debits", "Debits"][layout], 40]),
    ...d.withdrawals.map(tx),
  ];
}

export function w2Rows(d: W2Data): Row[] {
  return [
    row([`Form W-2 Wage and Tax Statement ${d.taxYear}`, 40], ["SAMPLE - TEST DATA", 400]),
    row(["c Employer's name, address, and ZIP code", 40]),
    row([d.employer, 40]),
    row(["e Employee's name", 40]),
    row([d.employee, 40]),
    row(["1 Wages, tips, other compensation", 40], [usd(d.box1), 330]),
    row(["2 Federal income tax withheld", 40], [usd(d.box2), 330]),
    row(["3 Social security wages", 40], [usd(d.box3), 330]),
    row(["4 Social security tax withheld", 40], [usd(d.box4), 330]),
    row(["5 Medicare wages and tips", 40], [usd(d.box5), 330]),
    row(["6 Medicare tax withheld", 40], [usd(d.box6), 330]),
  ];
}

export function f1040Rows(d: F1040Data): Row[] {
  return [
    row([`Form 1040 U.S. Individual Income Tax Return ${d.taxYear}`, 40], ["SAMPLE - TEST DATA", 400]),
    row([`Name: ${d.name}`, 40]),
    row(["1z Add lines 1a through 1h", 40], [whole(d.l1z), 470]),
    row(["9 This is your total income", 40], [whole(d.l9), 470]),
    row(["10 Adjustments to income from Schedule 1", 40], [whole(d.l10), 470]),
    row(["11 Subtract line 10 from line 9. This is your adjusted gross income", 40], [whole(d.l11), 470]),
    row(["12 Standard deduction or itemized deductions", 40], [whole(d.l12), 470]),
    row(["14 Add lines 12 and 13", 40], [whole(d.l14), 470]),
    row(["15 Subtract line 14 from line 11. This is your taxable income", 40], [whole(d.l15), 470]),
  ];
}

// ------------------------------------------------------------------ rendering

export async function rowsToPdf(rows: Row[], meta: { producer?: string; creator?: string; modifiedAfter?: boolean } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  let y = 740;
  for (const r of rows) {
    for (const c of r) if (c.text) page.drawText(c.text, { x: c.x, y, size: 10, font });
    y -= 18;
  }
  const created = new Date("2026-01-01T00:00:00Z");
  pdf.setProducer(meta.producer ?? "PayrollEngine Report Server 4.2");
  pdf.setCreator(meta.creator ?? "PayrollEngine");
  pdf.setCreationDate(created);
  pdf.setModificationDate(meta.modifiedAfter ? new Date(created.getTime() + 86_400_000) : created);
  return pdf.save({ useObjectStreams: false });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Render rows as a photo-like image: optional tilt, blur and JPEG compression. */
export async function rowsToImage(rows: Row[], o: { rotate?: number; blur?: number; jpegQuality?: number; scale?: number } = {}): Promise<Uint8Array> {
  const s = o.scale ?? 2.4;
  const width = Math.round(612 * s);
  const height = Math.round((60 + rows.length * 18 + 40) * s);
  const texts = rows.flatMap((r, i) => r.filter((c) => c.text).map((c) =>
    `<text x="${(c.x * s).toFixed(0)}" y="${((50 + i * 18) * s).toFixed(0)}" font-family="Helvetica, Arial, sans-serif" font-size="${(10 * s).toFixed(1)}" fill="#111">${esc(c.text)}</text>`));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fbfaf6"/>${texts.join("")}</svg>`;
  let img = sharp(Buffer.from(svg));
  if (o.rotate) img = sharp(await img.png().toBuffer()).rotate(o.rotate, { background: "#fbfaf6" });
  if (o.blur && o.blur >= 0.3) img = img.blur(o.blur); // sharp needs sigma >= 0.3
  return new Uint8Array(o.jpegQuality ? await img.jpeg({ quality: o.jpegQuality }).toBuffer() : await img.png().toBuffer());
}

// ------------------------------------------------------------------ digital signatures

export interface TestIssuer { p12: Buffer; passphrase: string; fingerprint: string; name: string }

/** A self-made signing certificate standing in for an employer's or bank's document-signing key. */
export function makeTestIssuer(name = "Acme Corp Payroll (SAMPLE issuer)"): TestIssuer {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
  cert.serialNumber = "01" + Date.now().toString(16);
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 5 * 365 * 86_400_000);
  const attrs = [{ name: "commonName", value: name }, { name: "organizationName", value: "Need-to-Know test data" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  const key = forge.pki.privateKeyFromPem(privateKey);
  cert.sign(key, forge.md.sha256.create());
  const passphrase = "sample-only";
  const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], passphrase, { algorithm: "3des" });
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const fingerprint = forge.md.sha256.create().update(der).digest().toHex();
  return { p12: Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary"), passphrase, fingerprint, name };
}

export async function signPdf(pdf: Uint8Array, issuer: TestIssuer): Promise<Uint8Array> {
  const withPlaceholder = plainAddPlaceholder({ pdfBuffer: Buffer.from(pdf), reason: "Issued by employer", contactInfo: "payroll@example.com", name: issuer.name, location: "Sample" });
  const signer = new P12Signer(issuer.p12, { passphrase: issuer.passphrase });
  const signpdf = (signpdfModule as unknown as { default?: typeof signpdfModule }).default ?? signpdfModule;
  return new Uint8Array(await signpdf.sign(withPlaceholder, signer));
}

// ------------------------------------------------------------------ the demo set (matches the demo bank data)

const isoDaysAgo = (now: Date, n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);

/** Documents for Maya and Leo whose numbers line up with fixtureDeposits() for the same `now`. */
export function demoDocumentData(now = new Date()) {
  const year = now.getUTCFullYear();
  // Net pay matches the paychecks in fixtureDeposits(): Maya $4,100, Leo $2,300, both paid 3 days ago.
  const withNet = (d: PayStubData, net: number): PayStubData => {
    const periods = Math.round(d.grossYtd / d.gross);
    return { ...d, net, deductions: r2(d.gross - net), netYtd: r2(net * periods), deductionsYtd: r2(d.grossYtd - net * periods) };
  };
  const maya = withNet(payStub({ employer: "Acme Corp Payroll", employee: "Maya Patel", payDate: isoDaysAgo(now, 3), gross: 5616.44 }), 4100);
  const leo = withNet(payStub({ employer: "Bean There Cafe Payroll", employee: "Leo Okafor", payDate: isoDaysAgo(now, 3), gross: 3150.68 }), 2300);

  // Leo's edits: crude (gross changed, nothing else) and careful (gross and net changed consistently).
  const leoCrude = { ...leo, gross: 4650.68, grossYtd: r2(leo.grossYtd * 4650.68 / leo.gross) };
  const leoCareful = payStub({ employer: "Bean There Cafe Payroll", employee: "Leo Okafor", payDate: leo.payDate, gross: 4650.68 });

  // A completed calendar month, never a statement covering days still in the future.
  const start = new Date(Date.UTC(year, now.getUTCMonth() - 1, 1));
  const stmtStart = start.toISOString().slice(0, 10);
  const stmtEnd = new Date(Date.UTC(year, now.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const monthDay = (day: number) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day)).toISOString().slice(0, 10);
  const mayaDeposits: StatementTx[] = fixtureDeposits("maya", now)
    .filter((d) => d.date >= stmtStart && d.date <= stmtEnd)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-2)
    .map((d) => ({ date: d.date, desc: "ACME CORP PAYROLL PPD", amount: d.amount }));
  const mayaStatement: StatementData = {
    bank: "Northwind Community Bank", holder: "Maya Patel", periodStart: stmtStart, periodEnd: stmtEnd, opening: 3120.55,
    deposits: mayaDeposits,
    withdrawals: [
      { date: monthDay(1), desc: "RENT - ELM ST APTS", amount: 2100 },
      { date: monthDay(10), desc: "GROCERY MART", amount: 182.4 },
      { date: monthDay(20), desc: "CITY POWER & LIGHT", amount: 96.15 },
    ],
  };
  const mayaW2 = w2({ taxYear: year - 1, employer: "Acme Corp", employee: "Maya Patel", wages: 142800, pretax: 6000 });
  const maya1040 = form1040({ taxYear: year - 1, name: "Maya Patel", wages: mayaW2.box1, other: 410 });
  return { maya, leo, leoCrude, leoCareful, mayaStatement, mayaW2, maya1040 };
}
