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

// Reproduces the scanner-fixes.md text layer, including its column spacing.
const demoStatementLines = (second = false, complete = true, month = "Sep") => {
  const lines = `FIRST NATIONAL BANK   ACCOUNT STATEMENT
Member FDIC | Equal Housing Lender   Statement Period: ${month} 01, 2026 – ${month} ${month === "Sep" ? "30" : "31"}, 2026
Account Holder: Demo User   Account Number: ********4821
Address: 123 Harbor View Way, Apt 4B   Primary Phone: (555) 019-2831
Account Type: Preferred Checking   Branch: Downtown Financial Center
STARTING BALANCE   TOTAL DEPOSITS   TOTAL WITHDRAWALS   ENDING BALANCE
$3,120.00   $5,800.00   $4,150.00   $4,770.00
Account Activity & Deposits
Date   Description   Category   Amount
${month} 03, 2026   GROCERY MARKET #4021   POS Debit   -$142.50
${month} 08, 2026   CITY UTILITIES WATER & POWER   ACH Withdrawal   -$118.20
${month} 15, 2026   ACME CORP PAYROLL DIRECT DEP   Direct Deposit   +$2,900.00
${month} 20, 2026   STREAMING SERVICE MONTHLY   Recurring Debit   -$15.99
${month} 25, 2026   AUTO INSURANCE MONTHLY PREMIUM   ACH Withdrawal   -$185.00
${month} ${month === "Sep" ? "30" : "31"}, 2026   ACME CORP PAYROLL DIRECT DEP   Direct Deposit   +$2,900.00
Total Direct Deposits   $5,800.00
First National Bank — Demo Statement   Page ${second ? "2" : "1"} of 2`.split("\n");
  if (second) {
    for (let i = 0; i < lines.length; i++) lines[i] = lines[i]
      .replaceAll("$3,120.00", "$6,450.00").replaceAll("$5,800.00", "$8,800.00")
      .replaceAll("$4,150.00", "$5,200.00").replaceAll("$4,770.00", "$10,050.00")
      .replaceAll("ACME CORP", "TECH CORP").replaceAll("$2,900.00", "$4,400.00")
      .replaceAll("$142.50", "$200.00").replaceAll("$118.20", "$150.00")
      .replaceAll("$15.99", "$15.59").replaceAll("$185.00", "$240.00");
  }
  if (complete) lines.splice(-2, 0, `${month} 26, 2026   RENT PAYMENT   ACH Withdrawal   -$${second ? "4,594.41" : "3,688.31"}`);
  return lines;
};

async function statementPdf(pages: string[][]) {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = pdf.addPage([900, 792]);
    lines.forEach((line, i) => {
      let x = 30;
      for (const cell of line.split(/\s{3,}/)) {
        page.drawText(cell, { x, y: 750 - i * 20, size: 10, font });
        x += font.widthOfTextAtSize(cell, 10) + 25;
      }
    });
  }
  return { name: "name.pdf", type: "application/pdf", data: await pdf.save({ useObjectStreams: false }) };
}

test("separate September statements in one PDF each pass, including all totals", async () => {
  const { analyzeDocuments } = await import("../lib/documents/analyze");
  const file = await statementPdf([demoStatementLines(), demoStatementLines(true)]);
  const { extractDocument } = await import("../lib/documents/extract");
  const text = await extractDocument(file, []);
  assert.equal(text.pages?.length, 2);
  const d = await analyzeDocuments([file], { now, rent: 2400, multiple: 3 });
  assert.deepEqual(d.reports.map((r) => r.fileName), ["name.pdf (page 1)", "name.pdf (page 2)"]);
  d.reports.forEach((r, i) => {
    assert.deepEqual(failed(r), [], JSON.stringify(r));
    assert.equal(r.usable, true);
    assert.equal(r.deposits?.length, 2);
    assert.ok(Math.abs(r.monthlyIncome! - [5800, 8800][i]) / [5800, 8800][i] < 0.02);
    assert.equal(r.fields.openingBalance, [3120, 6450][i]);
    assert.equal(r.fields.closingBalance, [4770, 10050][i]);
    for (const id of ["deposit_total", "withdrawal_total", "balance"]) assert.equal(r.checks.find((c) => c.id === id)?.status, "pass");
  });
});

test("complete October statements still fail only for being future-dated", async () => {
  const { analyzeDocuments } = await import("../lib/documents/analyze");
  const d = await analyzeDocuments([await statementPdf([demoStatementLines(false, true, "Oct"), demoStatementLines(true, true, "Oct")])], { now, rent: 2400, multiple: 3 });
  for (const r of d.reports) {
    assert.deepEqual(failed(r), ["age"]);
    assert.match(r.checks.find((c) => c.status === "fail")!.label, /Dated in the future \(2026-10-31\)/);
  }
  assert.match(d.reason!, /Dated in the future/);
});

test("incomplete extracted withdrawal rows fail and name listed and stated totals", async () => {
  const { analyzeDocuments } = await import("../lib/documents/analyze");
  const d = await analyzeDocuments([await statementPdf([demoStatementLines(false, false), demoStatementLines(true, false)])], { now, rent: 2400, multiple: 3 });
  d.reports.forEach((r, i) => {
    assert.deepEqual(failed(r), ["withdrawal_total"]);
    const label = r.checks.find((c) => c.id === "withdrawal_total")!.label;
    assert.ok(label.includes(["$461.69", "$605.59"][i]), label);
    assert.ok(label.includes(["$4,150.00", "$5,200.00"][i]), label);
    assert.equal(r.usable, false);
  });
  assert.equal(d.reason, d.reports[0].checks.find((c) => c.status === "fail")!.label);
});

test("short month dates and explicit categories distinguish unsigned debits from credits", async () => {
  const { parseBankStatement } = await import("../lib/documents/parse");
  const lines = demoStatementLines().map((line) => line.replace(/Sep (\d+), 2026(?=   )/, "Sep $1").replace(/-\$/g, "$"));
  // Even a description containing 'credit' cannot overrule a debit category.
  lines[9] = lines[9].replace("GROCERY MARKET #4021", "CREDIT CARD PAYMENT");
  const r = parseBankStatement(lines);
  assert.equal(r.deposits?.length, 2);
  assert.deepEqual(r.deposits?.map((d) => d.date), ["2026-09-15", "2026-09-30"]);
  assert.deepEqual(r.checks.filter((c) => c.status === "fail"), []);
  assert.equal(parseDate("Oct 3", 2026), "2026-10-03");
  assert.equal(parseDate("Oct 3"), undefined);
  assert.deepEqual(moneyTokens("+$2,900.00 -$142.50"), [2900, -142.5]);
  assert.ok(cleanOcrLine("TOTAL DEPOSITS   ENDING BALANCE").includes("   "));
});

test("a missing withdrawal row is rejected even when none of the withdrawals parsed", async () => {
  const { parseBankStatement } = await import("../lib/documents/parse");
  const lines = demoStatementLines().filter((l) => !/Withdrawal|Debit/.test(l));
  const r = parseBankStatement(lines);
  assert.ok(r.checks.some((c) => c.id === "withdrawal_total" && c.status === "fail" && c.label.includes("$0.00")));
});

test("a continuation page without a new statement header stays with its statement", async () => {
  const { analyzeDocuments } = await import("../lib/documents/analyze");
  const lines = demoStatementLines();
  const split = 12;
  const d = await analyzeDocuments([await statementPdf([lines.slice(0, split), lines.slice(split)])], { now, rent: 2400, multiple: 3 });
  assert.equal(d.reports.length, 1);
  assert.equal(d.reports[0].fileName, "name.pdf");
  assert.deepEqual(failed(d.reports[0]), []);
});

test("a blank PDF explains how to obtain readable text", async () => {
  const r = await analyze(await statementPdf([[]]));
  assert.equal(r.usable, false);
  assert.equal(decide([r], 2400, 3).reason, "Couldn't read any text. Try a sharper photo or the original PDF.");
});

test("sample statements use a completed calendar month, including across year boundaries", () => {
  for (const date of ["2026-10-17", "2026-01-01", "2024-03-01"]) {
    const today = new Date(`${date}T12:00:00Z`);
    const statement = demoDocumentData(today).mayaStatement;
    assert.equal(statement.periodStart.slice(8), "01");
    assert.ok(statement.periodEnd < date);
    const next = new Date(Date.parse(statement.periodEnd) + 86_400_000).toISOString().slice(0, 10);
    assert.equal(next, date.slice(0, 7) + "-01");
    for (const tx of [...statement.deposits, ...statement.withdrawals]) assert.ok(tx.date >= statement.periodStart && tx.date <= statement.periodEnd);
  }
});
