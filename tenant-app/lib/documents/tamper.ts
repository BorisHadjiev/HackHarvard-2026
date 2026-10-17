// Signs that a PDF or photo was edited after it was issued. These are signals, not proof:
// they mark a document suspicious (warn) or unusable (fail), and the tenant sees why.
import type { DocumentCheck, ExtractedText, SignatureStatus } from "./types";

/** Tools people use to edit or fabricate PDFs. Real statements come from bank/payroll systems. */
const EDITORS = /(photoshop|illustrator|gimp|canva|ilovepdf|smallpdf|sejda|pdfescape|pdffiller|dochub|foxit phantom|nitro pro|pdf-xchange|inkscape|libreoffice|openoffice|microsoft.*word|google docs|pages|preview)/i;

export function tamperChecks(ex: ExtractedText): { checks: DocumentCheck[]; signature: SignatureStatus } {
  const checks: DocumentCheck[] = [];
  let signature: SignatureStatus = "none";

  if (ex.method !== "pdf_text") {
    const c = ex.ocrConfidence ?? 0;
    if (c < 55) checks.push({ id: "ocr", status: "fail", label: `Too hard to read (${c}% confidence). Retake the photo flat and well lit.` });
    else if (c < 75) checks.push({ id: "ocr", status: "warn", label: `Partly hard to read (${c}% confidence)` });
    else checks.push({ id: "ocr", status: "info", label: `Read from an image (${c}% confidence). Photos can't prove a document wasn't edited.` });
  }

  const pdf = ex.pdf;
  if (!pdf) return { checks, signature };

  const tool = [pdf.producer, pdf.creator].find((v) => v && EDITORS.test(v));
  if (tool) checks.push({ id: "editor", status: "warn", label: `Made or saved with an editing tool (${tool})` });

  if (pdf.creationDate && pdf.modDate && Date.parse(pdf.modDate) - Date.parse(pdf.creationDate) > 60_000) {
    checks.push({ id: "modified", status: "warn", label: "Modified after it was created" });
  }

  const sigs = pdf.signatures;
  if (sigs.length) {
    const bad = sigs.find((s) => !s.valid);
    const appended = sigs.find((s) => s.valid && !s.coversWholeFile);
    const trusted = sigs.find((s) => s.trusted);
    if (bad) {
      signature = "invalid";
      checks.push({ id: "signature", status: "fail", label: "Digital signature is broken: the document changed after it was signed" });
    } else if (appended && !trusted) {
      signature = "invalid";
      checks.push({ id: "signature", status: "fail", label: "Content was added after the document was signed" });
    } else if (trusted) {
      signature = "trusted";
      checks.push({ id: "signature", status: "pass", label: `Digitally signed by ${trusted.signer ?? "a trusted issuer"} and unchanged since` });
    } else {
      signature = "untrusted";
      checks.push({ id: "signature", status: "info", label: `Signed by ${sigs[0].signer ?? "an unknown signer"}, who isn't on the trusted list` });
    }
  } else if (pdf.eofCount > 1) {
    checks.push({ id: "resaved", status: "warn", label: "Saved again after it was first made" });
  }
  return { checks, signature };
}
