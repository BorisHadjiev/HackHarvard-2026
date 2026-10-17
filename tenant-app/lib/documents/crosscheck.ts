// Does the document agree with the bank's own records? The bank data comes straight from the bank
// (Nessie or Plaid), so a match is independent confirmation that the document is real.
import { evaluateIncome } from "../income";
import type { Deposit } from "../nessie";
import { daysBetween } from "./text";
import type { BankMatch, DocumentCheck, ParsedDocument } from "./types";

export interface BankData {
  deposits: Deposit[];
  /** "nessie", "plaid" or "fixture" (demo data). */
  source: string;
}

const inWindow = (date: string, deposits: Deposit[]) => {
  const dates = deposits.map((d) => d.date).sort();
  return dates.length > 0 && date >= dates[0] && date <= dates[dates.length - 1];
};

export function crossCheck(doc: ParsedDocument, bank: BankData | undefined, now: Date): { match: BankMatch; check?: DocumentCheck } {
  if (!bank || !bank.deposits.length) return { match: "not_checked" };
  const deps = bank.deposits;

  if (doc.kind === "pay_stub") {
    const net = Number(doc.fields.netPay);
    const payDate = String(doc.fields.payDate ?? "");
    if (!net || !payDate) return { match: "not_checked" };
    const hit = deps.find((d) => Math.abs(d.amount - net) <= 1 && Math.abs(daysBetween(payDate, d.date)) <= 4);
    if (hit) return { match: "matched", check: { id: "bank", status: "pass", label: `Net pay arrived in your bank on ${hit.date}` } };
    if (!inWindow(payDate, deps)) return { match: "not_checked", check: { id: "bank", status: "info", label: "Pay date is outside the bank data the app can see" } };
    return { match: "not_matched", check: { id: "bank", status: "fail", label: "This net pay never arrived in your bank around the pay date" } };
  }

  if (doc.kind === "bank_statement") {
    const listed = (doc.deposits ?? []).filter((d) => inWindow(d.date, deps));
    if (!listed.length) return { match: "not_checked", check: { id: "bank", status: "info", label: "Statement period is outside the bank data the app can see" } };
    const found = listed.filter((s) => deps.some((d) => Math.abs(d.amount - s.amount) <= 0.01 && Math.abs(daysBetween(s.date, d.date)) <= 3)).length;
    const share = found / listed.length;
    if (share >= 0.9) return { match: "matched", check: { id: "bank", status: "pass", label: `${found} of ${listed.length} deposits match your bank's records` } };
    return { match: "not_matched", check: { id: "bank", status: "fail", label: `Only ${found} of ${listed.length} deposits match your bank's records` } };
  }

  if ((doc.kind === "w2" || doc.kind === "form_1040") && doc.monthlyIncome) {
    // Tax documents cover a past year, so only a rough check is possible: take-home pay in the bank
    // should be a plausible fraction of the gross income on the form.
    const bankMonthly = evaluateIncome(deps, 0, 0, now).medianMonthlyIncome;
    const ratio = bankMonthly / doc.monthlyIncome;
    if (ratio >= 0.55 && ratio <= 1.1) return { match: "matched", check: { id: "bank", status: "pass", label: "Income on the form is consistent with your bank deposits" } };
    return { match: "not_matched", check: { id: "bank", status: "warn", label: "Income on the form doesn't fit your current bank deposits (it may have changed since)" } };
  }
  return { match: "not_checked" };
}
