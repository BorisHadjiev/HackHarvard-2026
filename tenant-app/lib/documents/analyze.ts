// The document pipeline: read -> recognize -> check -> cross-check -> decide. All on this device.
import type { EvidenceStrength } from "@ntk/shared";
import { crossCheck, type BankData } from "./crosscheck";
import { extractDocument, MAX_FILE_BYTES, MAX_FILES } from "./extract";
import { parseDocument } from "./parse";
import { tamperChecks } from "./tamper";
import { daysBetween, round2 } from "./text";
import type { DocumentDecision, DocumentReport, ExtractedText, UploadedFile } from "./types";
import { ageOn, readIdCard, type IdReadResult } from "./id-card";

/** Fixed descriptions (never per tenant) so pooled landlords can't tell tenants apart by them. */
export const DOCUMENT_METHOD = "income documents, annualized gross income";
export const DOCUMENT_WINDOW_DAYS = 365;

/** How recent a document must be to count. */
const MAX_AGE_DAYS = { pay_stub: 60, bank_statement: 75 } as const;

export function trustedSigners(): string[] {
  return (process.env.TRUSTED_DOCUMENT_SIGNERS ?? "").split(",").map((s) => s.trim().toLowerCase().replace(/:/g, "")).filter(Boolean);
}

export async function analyzeFileReports(file: UploadedFile, opts: { bank?: BankData; now: Date; trusted: string[] }): Promise<DocumentReport[]> {
  const base = { fileName: file.name, readMethod: "pdf_text" as const, bankMatch: "not_checked" as const, signature: "none" as const };
  if (file.data.byteLength > MAX_FILE_BYTES) {
    return [{ ...base, kind: "unknown", fields: {}, usable: false, checks: [{ id: "size", status: "fail", label: "File is larger than 10 MB" }] }];
  }
  let extracted;
  try {
    extracted = await extractDocument(file, opts.trusted);
  } catch (err) {
    return [{ ...base, kind: "unknown", fields: {}, usable: false, checks: [{ id: "read", status: "fail", label: (err as Error).message }] }];
  }
  const segments: { page: number; lines: string[] }[] = [];
  for (const [i, lines] of (extracted.pages?.length ? extracted.pages : [extracted.lines]).entries()) {
    const header = lines.slice(0, 6).some((line) => /\b(?:account|monthly)\s+statement\b/i.test(line));
    if (!segments.length || header) segments.push({ page: i + 1, lines: [...lines] });
    else segments[segments.length - 1].lines.push(...lines);
  }
  return segments.map((segment) => reportExtracted(
    segments.length > 1 ? `${file.name} (page ${segment.page})` : file.name,
    { ...extracted, lines: segment.lines }, opts,
  ));
}

/** Kept for callers analyzing a single statement; the upload pipeline reports every statement. */
export async function analyzeFile(file: UploadedFile, opts: { bank?: BankData; now: Date; trusted: string[] }): Promise<DocumentReport> {
  return (await analyzeFileReports(file, opts))[0];
}

function reportExtracted(fileName: string, extracted: ExtractedText, opts: { bank?: BankData; now: Date }): DocumentReport {
  if (!extracted.lines.some((line) => line.trim())) {
    return { fileName, kind: "unknown", fields: {}, readMethod: extracted.method, bankMatch: "not_checked", signature: "none", usable: false,
      checks: [{ id: "read", status: "fail", label: "Couldn't read any text. Try a sharper photo or the original PDF." }] };
  }
  const parsed = parseDocument(extracted.lines);
  const tamper = tamperChecks(extracted);
  const checks = [...tamper.checks, ...parsed.checks];

  // Freshness: old pay stubs and statements don't describe current income; tax years lag by one.
  const year = opts.now.getUTCFullYear();
  const today = opts.now.toISOString().slice(0, 10);
  if ((parsed.kind === "pay_stub" || parsed.kind === "bank_statement") && parsed.periodEnd) {
    const age = daysBetween(parsed.periodEnd, today);
    if (age > MAX_AGE_DAYS[parsed.kind]) checks.push({ id: "age", status: "fail", label: `Too old: dated ${parsed.periodEnd}` });
    else if (age < -3) checks.push({ id: "age", status: "fail", label: `Dated in the future (${parsed.periodEnd})` });
  }
  if ((parsed.kind === "w2" || parsed.kind === "form_1040") && parsed.taxYear) {
    if (parsed.taxYear < year - 2) checks.push({ id: "age", status: "fail", label: `Tax year ${parsed.taxYear} is too old` });
    else if (parsed.taxYear >= year) checks.push({ id: "age", status: "fail", label: `Tax year ${parsed.taxYear} hasn't ended yet` });
  }

  const cross = crossCheck(parsed, opts.bank, opts.now);
  if (cross.check) checks.push(cross.check);
  return {
    ...parsed,
    checks,
    fileName,
    readMethod: extracted.method,
    ocrConfidence: extracted.ocrConfidence,
    bankMatch: cross.match,
    signature: tamper.signature,
    usable: parsed.kind !== "unknown" && !checks.some((c) => c.status === "fail"),
  };
}

/**
 * Pick the documents that describe current income and compute the answer.
 * Most recent evidence wins: pay stubs, then bank statements, then the latest tax year.
 */
export function decide(reports: DocumentReport[], rent: number, multiple: number): DocumentDecision {
  const usable = reports.filter((r) => r.usable && r.monthlyIncome !== undefined);
  let counted: DocumentReport[] = [];
  let monthly = 0;

  const stubs = usable.filter((r) => r.kind === "pay_stub");
  const statements = usable.filter((r) => r.kind === "bank_statement");
  const tax = usable.filter((r) => r.kind === "w2" || r.kind === "form_1040");
  if (stubs.length) {
    // Latest stub per employer, summed (two jobs count twice). Same date: keep the better-backed copy.
    const backing = (r: DocumentReport) => (r.signature === "trusted" ? 2 : r.bankMatch === "matched" ? 1 : 0);
    const byEmployer = new Map<string, DocumentReport>();
    for (const s of stubs) {
      const key = (s.issuer ?? s.fileName).toLowerCase();
      const prev = byEmployer.get(key);
      const newer = !prev || String(s.periodEnd) > String(prev.periodEnd);
      const sameDateStronger = !!prev && s.periodEnd === prev.periodEnd && backing(s) > backing(prev);
      if (newer || sameDateStronger) byEmployer.set(key, s);
    }
    counted = [...byEmployer.values()];
    monthly = counted.reduce((sum, s) => sum + (s.monthlyIncome ?? 0), 0);
  } else if (statements.length) {
    counted = statements;
    monthly = statements.reduce((sum, s) => sum + (s.monthlyIncome ?? 0), 0) / statements.length;
  } else if (tax.length) {
    const latest = Math.max(...tax.map((t) => t.taxYear ?? 0));
    const forms = tax.filter((t) => t.taxYear === latest);
    const returns = forms.filter((t) => t.kind === "form_1040");
    counted = returns.length ? [returns[0]] : forms; // a 1040 already includes every W-2
    monthly = counted.reduce((sum, t) => sum + (t.monthlyIncome ?? 0), 0);
  }

  if (!counted.length) {
    return { reports, counted: [], monthlyIncome: 0, meets: false, strength: null, reason: reports.flatMap((r) => r.checks).find((c) => c.status === "fail")?.label ?? (reports.length ? "None of the documents passed the checks" : "No documents") };
  }
  let strength: EvidenceStrength;
  if (counted.every((r) => r.signature === "trusted")) strength = "document_signed";
  else if (counted.every((r) => r.signature === "trusted" || r.bankMatch === "matched")) strength = "document_bank_matched";
  else strength = "document_unverified";

  monthly = round2(monthly);
  return { reports, counted: counted.map((r) => r.fileName), monthlyIncome: monthly, meets: monthly >= multiple * rent, strength };
}

export async function analyzeDocuments(files: UploadedFile[], opts: { bank?: BankData; now?: Date; rent: number; multiple: number }): Promise<DocumentDecision> {
  const now = opts.now ?? new Date();
  const trusted = trustedSigners();
  const reports: DocumentReport[] = [];
  for (const file of files.slice(0, MAX_FILES)) reports.push(...await analyzeFileReports(file, { bank: opts.bank, now, trusted }));
  return decide(reports, opts.rent, opts.multiple);
}

// ---------------------------------------------------------------- age (government ID)

export interface AgeDecision {
  /** At least `minAge` on today's UTC date, computed from the first usable ID. */
  meets: boolean;
  /** False when no uploaded ID passed every check: nothing is signed then. */
  usable: boolean;
  reason?: string;
  /** Reports carry only pass/fail and words: no date, age, name or issuer. */
  reports: DocumentReport[];
}

/** Read every upload as an ID. Income documents fail the ID checks and are simply not usable here. */
export async function analyzeIdDocuments(files: UploadedFile[], now = new Date()): Promise<IdReadResult[]> {
  const results: IdReadResult[] = [];
  for (const file of files.slice(0, MAX_FILES)) {
    if (file.data.byteLength > MAX_FILE_BYTES) {
      results.push({ report: { fileName: file.name, kind: "id_card", fields: {}, readMethod: "pdf_text", bankMatch: "not_checked", signature: "none", usable: false, checks: [{ id: "size", status: "fail", label: "File is larger than 10 MB" }] }, private: {} });
      continue;
    }
    results.push(await readIdCard(file, now));
  }
  return results;
}

/** The yes/no. The dates in `results[].private` are read here and go no further. */
export function decideAge(results: IdReadResult[], minAge: number, now = new Date()): AgeDecision {
  const reports = results.map((r) => r.report);
  const usable = results.find((r) => r.report.usable && r.private.dob);
  if (!usable) {
    const firstFail = reports.flatMap((r) => r.checks).find((c) => c.status === "fail");
    return { meets: false, usable: false, reason: reports.length ? firstFail?.label ?? "The ID couldn't be read" : "No ID uploaded", reports };
  }
  const age = ageOn(usable.private.dob!, now);
  return { meets: age !== undefined && age >= minAge, usable: true, reports };
}
