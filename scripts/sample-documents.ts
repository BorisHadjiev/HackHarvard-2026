// Make demo documents that line up with today's demo bank data (Maya and Leo), plus a signed
// pay stub and two forged ones. Re-run on demo day: dates are relative to today.
//   npm run sample-docs        writes sample-documents/ (git-ignored)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { upsertEnv } from "./env-file";
import { demoDocumentData, f1040Rows, makeTestIssuer, payStubRows, rowsToImage, rowsToPdf, signPdf, statementRows, w2Rows, type TestIssuer } from "./lib/sample-documents";

const root = process.cwd();
const out = path.join(root, "sample-documents");
mkdirSync(out, { recursive: true });

// A test "employer signing key", kept in git-ignored .keys/ and trusted by this tenant app only.
const issuerPath = path.join(root, ".keys", "document-issuer.json");
let issuer: TestIssuer;
if (existsSync(issuerPath)) {
  const saved = JSON.parse(readFileSync(issuerPath, "utf8"));
  issuer = { ...saved, p12: Buffer.from(saved.p12, "base64") };
} else {
  mkdirSync(path.dirname(issuerPath), { recursive: true });
  issuer = makeTestIssuer();
  writeFileSync(issuerPath, JSON.stringify({ ...issuer, p12: issuer.p12.toString("base64") }), { mode: 0o600 });
}
upsertEnv(path.join(root, "tenant-app/.env.local"), { TRUSTED_DOCUMENT_SIGNERS: issuer.fingerprint });

const d = demoDocumentData(new Date());
const year = new Date().getUTCFullYear() - 1;
const files: [string, Uint8Array | Promise<Uint8Array>, string][] = [
  ["maya-pay-stub.pdf", rowsToPdf(payStubRows(d.maya)), "Counts. Net pay matches Maya's bank: documents confirmed by bank, answer YES."],
  ["maya-pay-stub-photo.jpg", rowsToImage(payStubRows(d.maya), { rotate: 0.8, blur: 0.5, jpegQuality: 78 }), "A phone photo of the same stub. Read with on-device OCR."],
  ["maya-pay-stub-signed.pdf", rowsToPdf(payStubRows(d.maya)).then((pdf) => signPdf(pdf, issuer)), "Digitally signed by a trusted test issuer: signed documents."],
  ["maya-bank-statement.pdf", rowsToPdf(statementRows(d.mayaStatement)), "Past full calendar month. Balances and listed transaction totals add up."],
  [`maya-w2-${year}.pdf`, rowsToPdf(w2Rows(d.mayaW2)), "Payroll tax math checks out."],
  [`maya-1040-${year}.pdf`, rowsToPdf(f1040Rows(d.maya1040)), "AGI math checks out."],
  ["leo-pay-stub.pdf", rowsToPdf(payStubRows(d.leo)), "Genuine. Matches Leo's bank, answer NO."],
  ["leo-pay-stub-EDITED.pdf", rowsToPdf(payStubRows(d.leoCrude), { producer: "iLovePDF", modifiedAfter: true }), "Crude edit: gross raised. Fails the arithmetic check; not used."],
  ["leo-pay-stub-EDITED-careful.pdf", rowsToPdf(payStubRows(d.leoCareful)), "Careful edit: adds up, but this net pay never reached Leo's bank; not used when confirming with the bank."],
];
const readme = ["Need-to-Know demo documents (SAMPLE data, fictional employers and bank).", `Generated ${new Date().toISOString()} to match today's demo bank data. Re-run \`npm run sample-docs\` on demo day.`, ""];
for (const [name, data, note] of files) {
  writeFileSync(path.join(out, name), await data);
  readme.push(`${name}\n  ${note}`);
}
writeFileSync(path.join(out, "README.txt"), readme.join("\n") + "\n");
console.log(`Wrote ${files.length} documents to sample-documents/.`);
console.log(`Trusted test signer ${issuer.fingerprint.slice(0, 16)}… added to TRUSTED_DOCUMENT_SIGNERS in tenant-app/.env.local.`);
console.log("Restart the tenant app if it was running so it picks up the trusted signer.");
