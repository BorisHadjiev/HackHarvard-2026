import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureDeposits } from "../lib/nessie";
import { analyzeFile, decide } from "../lib/documents/analyze";
import { cleanOcrLine, moneyTokens, parseDate } from "../lib/documents/text";
import type { DocumentReport } from "../lib/documents/types";
import {
  demoDocumentData, f1040Rows, form1040, makeTestIssuer, payStub, payStubRows, rowsToImage, rowsToPdf, signPdf, statementRows, w2, w2Rows,
} from "../../scripts/lib/sample-documents";

const now = new Date("2026-10-17T12:00:00Z");
const demo = demoDocumentData(now);
const mayaBank = { deposits: fixtureDeposits("maya", now), source: "fixture" };
const leoBank = { deposits: fixtureDeposits("leo", now), source: "fixture" };
const pdfFile = async (name: string, rows: Parameters<typeof rowsToPdf>[0], meta?: Parameters<typeof rowsToPdf>[1]) => ({ name, type: "application/pdf", data: await rowsToPdf(rows, meta) });
const analyze = (file: { name: string; type: string; data: Uint8Array }, bank?: typeof mayaBank, trusted: string[] = []) => analyzeFile(file, { bank, now, trusted });
const failed = (r: DocumentReport) => r.checks.filter((c) => c.status === "fail").map((c) => c.id);

test("helpers read dates, amounts and fix common OCR misreads", () => {
  assert.equal(parseDate("10/03/2026"), "2026-10-03");
  assert.equal(parseDate("10/3/26"), "2026-10-03");
  assert.equal(parseDate("Oct 3, 2026"), "2026-10-03");
  assert.equal(parseDate("09/31/2026"), undefined);
  assert.deepEqual(moneyTokens("Gross Pay 5,616.44 224,657.60"), [5616.44, 224657.6]);
  assert.equal(cleanOcrLine("Net Pay  4,1O0.00"), "Net Pay 4,100.00");
  assert.equal(cleanOcrLine("Net Pay S4,100.00"), "Net Pay $4,100.00");
});

test("a genuine pay stub is read, checks out, and matches the bank deposit", async () => {
  const r = await analyze(await pdfFile("maya-stub.pdf", payStubRows(demo.maya)), mayaBank);
  assert.equal(r.kind, "pay_stub");
  assert.equal(r.fields.grossPay, 5616.44);
  assert.equal(r.fields.netPay, 4100);
  assert.equal(r.fields.frequency, "biweekly");
  assert.equal(r.monthlyIncome, 12168.95);
  assert.deepEqual(failed(r), []);
  assert.equal(r.bankMatch, "matched");
  assert.equal(r.usable, true);
  const d = decide([r], 2400, 3);
  assert.equal(d.strength, "document_bank_matched");
  assert.equal(d.meets, true);
});

test("all three pay stub layouts parse to the same numbers", async () => {
  for (const layout of [0, 1, 2] as const) {
    const r = await analyze(await pdfFile(`stub-${layout}.pdf`, payStubRows(demo.leo, layout)));
    assert.equal(r.kind, "pay_stub", `layout ${layout}`);
    assert.equal(r.fields.grossPay, 3150.68, `layout ${layout}`);
    assert.equal(r.fields.payDate, demo.leo.payDate, `layout ${layout}`);
    assert.deepEqual(failed(r), [], `layout ${layout}`);
  }
});

test("Leo's crude edit (gross raised, nothing else) fails the arithmetic check", async () => {
  const r = await analyze(await pdfFile("leo-edited.pdf", payStubRows(demo.leoCrude)), leoBank);
  assert.ok(failed(r).includes("arithmetic"));
  assert.equal(r.usable, false);
  assert.equal(decide([r], 2400, 3).strength, null);
});

test("Leo's careful edit adds up, but the bank never received that net pay", async () => {
  const file = await pdfFile("leo-careful.pdf", payStubRows(demo.leoCareful));
  const withBank = await analyze(file, leoBank);
  assert.equal(withBank.bankMatch, "not_matched");
  assert.equal(withBank.usable, false);
  // Without a bank connection nothing can contradict it, so it counts only as unverified.
  const noBank = await analyze(file);
  assert.equal(noBank.usable, true);
  assert.equal(decide([noBank], 2400, 3).strength, "document_unverified");
});

test("a genuine bank statement balances and matches the bank; an inflated one doesn't", async () => {
  const ok = await analyze(await pdfFile("maya-statement.pdf", statementRows(demo.mayaStatement)), mayaBank);
  assert.equal(ok.kind, "bank_statement");
  assert.equal(ok.fields.deposits, 2);
  assert.deepEqual(failed(ok), []);
  assert.equal(ok.bankMatch, "matched");

  const inflated = { ...demo.mayaStatement, deposits: demo.mayaStatement.deposits.map((d, i) => (i === 0 ? { ...d, amount: 7100 } : d)), statedClosing: 0 };
  const bad = await analyze(await pdfFile("inflated.pdf", statementRows({ ...inflated, statedClosing: undefined, statedDepositTotal: 8200 })), mayaBank);
  assert.ok(failed(bad).includes("deposit_total"));
  assert.equal(bad.usable, false);
});

test("W-2: payroll tax math passes when genuine and fails when wages are inflated", async () => {
  const ok = await analyze(await pdfFile("w2.pdf", w2Rows(demo.mayaW2)), mayaBank);
  assert.equal(ok.kind, "w2");
  assert.equal(ok.taxYear, 2025);
  assert.equal(ok.fields.box1, 136800);
  assert.deepEqual(failed(ok), []);
  assert.equal(ok.bankMatch, "matched");

  const forged = { ...demo.mayaW2, box1: 186800, box3: 176000, box5: 192800 };
  const bad = await analyze(await pdfFile("w2-forged.pdf", w2Rows(forged)));
  assert.ok(failed(bad).includes("ss_tax"));
  assert.ok(failed(bad).includes("medicare_tax"));
});

test("Form 1040: AGI must equal total income minus adjustments", async () => {
  const ok = await analyze(await pdfFile("1040.pdf", f1040Rows(demo.maya1040)));
  assert.equal(ok.kind, "form_1040");
  assert.equal(ok.fields.line11, demo.maya1040.l11);
  assert.deepEqual(failed(ok), []);
  const bad = await analyze(await pdfFile("1040-forged.pdf", f1040Rows({ ...demo.maya1040, l11: demo.maya1040.l11 + 40000 })));
  assert.ok(failed(bad).includes("agi"));
});

test("old documents and tax years that haven't ended don't count", async () => {
  const oldStub = payStub({ employer: "Acme Corp Payroll", employee: "Maya Patel", payDate: "2026-05-01", gross: 5000 });
  assert.ok(failed(await analyze(await pdfFile("old.pdf", payStubRows(oldStub)))).includes("age"));
  const thisYear = w2({ taxYear: 2026, employer: "Acme", employee: "Maya", wages: 90000 });
  assert.ok(failed(await analyze(await pdfFile("w2-2026.pdf", w2Rows(thisYear)))).includes("age"));
  const old1040 = form1040({ taxYear: 2022, name: "Maya", wages: 90000 });
  assert.ok(failed(await analyze(await pdfFile("1040-2022.pdf", f1040Rows(old1040)))).includes("age"));
});

test("a PDF saved with an editing tool is flagged", async () => {
  const r = await analyze(await pdfFile("edited.pdf", payStubRows(demo.maya), { producer: "iLovePDF", modifiedAfter: true }), mayaBank);
  const warns = r.checks.filter((c) => c.status === "warn").map((c) => c.id);
  assert.ok(warns.includes("editor"));
  assert.ok(warns.includes("modified"));
});

test("digital signatures: trusted and intact, untrusted, and changed after signing", async () => {
  const issuer = makeTestIssuer();
  const signed = await signPdf(await rowsToPdf(payStubRows(demo.maya)), issuer);
  const file = { name: "signed.pdf", type: "application/pdf", data: signed };

  const trusted = await analyze(file, undefined, [issuer.fingerprint]);
  assert.equal(trusted.signature, "trusted");
  assert.equal(decide([trusted], 2400, 3).strength, "document_signed");

  // A photo and a signed PDF of the same stub: the signed copy is the one that counts.
  const photoCopy = await analyze(await pdfFile("photo-copy.pdf", payStubRows(demo.maya)), mayaBank, [issuer.fingerprint]);
  const both = decide([photoCopy, trusted], 2400, 3);
  assert.deepEqual(both.counted, ["signed.pdf"]);
  assert.equal(both.strength, "document_signed");

  const unknown = await analyze(file, undefined, []);
  assert.equal(unknown.signature, "untrusted");
  assert.equal(decide([unknown], 2400, 3).strength, "document_unverified");

  // Change one byte inside the signed range (the binary comment on line 2, so the PDF still opens).
  const tampered = Buffer.from(signed);
  assert.equal(tampered.subarray(0, 9).toString("latin1"), "%PDF-1.7\n");
  tampered[11] ^= 0x01;
  const broken = await analyze({ ...file, data: new Uint8Array(tampered) }, undefined, [issuer.fingerprint]);
  assert.equal(broken.signature, "invalid");
  assert.equal(broken.usable, false);

  // Append content after signing (an "incremental update"): the signature no longer covers the file.
  const appended = Buffer.concat([Buffer.from(signed), Buffer.from("\n% appended after signing\n%%EOF\n")]);
  const extended = await analyze({ ...file, data: new Uint8Array(appended) }, undefined, [issuer.fingerprint]);
  assert.equal(extended.signature, "invalid");
  assert.equal(extended.usable, false);
});

test("an unrelated document is not used", async () => {
  const r = await analyze(await pdfFile("menu.pdf", [[{ text: "Lunch menu: soup of the day, grilled cheese, salad. Open daily.", x: 40 }]]));
  assert.equal(r.kind, "unknown");
  assert.equal(r.usable, false);
});

test("a photo of a pay stub is read on this device with OCR", { timeout: 120_000 }, async () => {
  const image = await rowsToImage(payStubRows(demo.maya), { rotate: 0.6, blur: 0.4, jpegQuality: 80 });
  const r = await analyze({ name: "stub.jpg", type: "image/jpeg", data: image }, mayaBank);
  assert.equal(r.readMethod, "image_ocr");
  assert.equal(r.kind, "pay_stub");
  assert.equal(r.fields.grossPay, 5616.44);
  assert.equal(r.fields.netPay, 4100);
  assert.equal(r.bankMatch, "matched");
  assert.ok((r.ocrConfidence ?? 0) >= 75, `confidence ${r.ocrConfidence}`);
  const { stopOcr } = await import("../lib/documents/ocr");
  await stopOcr();
});
