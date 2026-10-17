// Document evidence types. Owner: Sam. Everything here stays on the tenant's device.
import type { EvidenceStrength } from "@ntk/shared";
import type { Deposit } from "../nessie";

export type DocumentKind = "bank_statement" | "pay_stub" | "w2" | "form_1040" | "id_card" | "unknown";

export const KIND_LABELS: Record<DocumentKind, string> = {
  bank_statement: "Bank statement",
  pay_stub: "Pay stub",
  w2: "W-2",
  form_1040: "Form 1040 tax return",
  id_card: "Government ID",
  unknown: "Unrecognized document",
};

/** pass = verified OK, warn = suspicious but usable, fail = the document is not used. */
export type CheckStatus = "pass" | "warn" | "fail" | "info";
export interface DocumentCheck {
  id: string;
  status: CheckStatus;
  label: string;
}

export interface SignatureFacts {
  /** The signature is mathematically valid for the bytes it covers. */
  valid: boolean;
  /** The signature covers the whole file, so nothing was added after signing. */
  coversWholeFile: boolean;
  signer?: string;
  /** SHA-256 of the signer certificate, hex, for matching TRUSTED_DOCUMENT_SIGNERS. */
  fingerprint?: string;
  trusted: boolean;
  error?: string;
}

export interface PdfFacts {
  producer?: string;
  creator?: string;
  creationDate?: string;
  modDate?: string;
  /** Number of %%EOF markers. More than one means the file was saved again after it was made. */
  eofCount: number;
  signatures: SignatureFacts[];
}

export type ReadMethod = "pdf_text" | "pdf_ocr" | "image_ocr";

export interface ExtractedText {
  lines: string[];
  /** PDF pages in order, including blank pages, so separate statements stay separate. */
  pages?: string[][];
  method: ReadMethod;
  /** 0-100, OCR only. */
  ocrConfidence?: number;
  pdf?: PdfFacts;
}

export interface ParsedDocument {
  kind: DocumentKind;
  /** Employer, bank or "IRS Form 1040". */
  issuer?: string;
  periodStart?: string; // YYYY-MM-DD
  periodEnd?: string; // YYYY-MM-DD, or the pay date for a pay stub
  taxYear?: number;
  /** Gross monthly income this document supports. Shown to the tenant only, never sent. */
  monthlyIncome?: number;
  /** Parsed values, local only (e.g. grossPay, netPay, box1). */
  fields: Record<string, number | string>;
  /** Bank statements only. */
  deposits?: Deposit[];
  checks: DocumentCheck[];
}

export type BankMatch = "matched" | "not_matched" | "not_checked";
export type SignatureStatus = "trusted" | "untrusted" | "invalid" | "none";

export interface DocumentReport extends ParsedDocument {
  fileName: string;
  readMethod: ReadMethod;
  ocrConfidence?: number;
  bankMatch: BankMatch;
  signature: SignatureStatus;
  /** False if any check failed: the document doesn't count toward the answer. */
  usable: boolean;
}

export interface DocumentDecision {
  reports: DocumentReport[];
  /** File names of the documents the answer was computed from. */
  counted: string[];
  monthlyIncome: number;
  meets: boolean;
  strength: EvidenceStrength | null;
  /** Why no answer could be computed, when strength is null. */
  reason?: string;
}

export interface UploadedFile {
  name: string;
  type: string;
  data: Uint8Array;
}
