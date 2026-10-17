// Recognize a document and pull out the numbers that matter, plus internal consistency checks.
// A forger who edits one number usually breaks a total somewhere else; these checks catch that.
import type { Deposit } from "../nessie";
import { amountsFor, dateFor, daysBetween, DATE_PATTERN, dollarTokens, moneyTokens, near, parseDate, rangeFor, round2 } from "./text";
import type { DocumentCheck, DocumentKind, ParsedDocument } from "./types";

/** Government ID: driver's license / state ID front, or a passport data page (with or without a readable MRZ). */
export function looksLikeIdCard(lines: string[]): boolean {
  const text = lines.join("\n");
  const idWords = /(driver'?s? ?licen[sc]e|identification card|identity card|\bpassport\b|\bid card\b)/i;
  const fields = /(\bDOB\b|date of birth|\bBIRTH\b|\bEXP\b|expires|\bSEX\b|\bHGT\b|\bEYES\b|\bCLASS\b|nationality)/i;
  const mrz = /^[A-Z0-9<]{30}$|^[A-Z0-9<]{44}$/m;
  return (idWords.test(text) && fields.test(text)) || mrz.test(lines.map((l) => l.replace(/\s+/g, "")).join("\n"));
}

export function classify(lines: string[]): DocumentKind {
  const text = lines.join("\n");
  if (looksLikeIdCard(lines)) return "id_card";
  if (/\bW-?2\b/i.test(text) && /wage and tax statement/i.test(text)) return "w2";
  if (/\b1040\b/.test(text) && /individual income tax return/i.test(text)) return "form_1040";
  if (/(earnings statement|pay ?stub|pay statement|payslip|pay slip)/i.test(text) || (/gross pay/i.test(text) && /net pay/i.test(text))) return "pay_stub";
  const statementWords = /(statement period|account statement|monthly statement|(?:beginning|opening|previous) balance|(?:ending|closing|new) balance)/i;
  if (statementWords.test(text) && /(deposit|credit|addition)/i.test(text)) return "bank_statement";
  return "unknown";
}

const check = (id: string, status: DocumentCheck["status"], label: string): DocumentCheck => ({ id, status, label });
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Text after "Label:" on the first matching line, or the next line if the label stands alone. */
function valueAfter(lines: string[], label: RegExp): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const m = label.exec(lines[i]);
    if (!m) continue;
    const rest = lines[i].slice(m.index + m[0].length).replace(/^[\s:]+/, "").split(/\s{3,}/)[0].trim();
    if (rest) return rest;
    return lines[i + 1]?.split(/\s{3,}/)[0].trim();
  }
  return undefined;
}

// ---------------------------------------------------------------- pay stub

const PERIODS_PER_YEAR: Record<string, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

function payFrequency(text: string, periodDays?: number): string | undefined {
  const m = /\b(weekly|bi-?weekly|every two weeks|semi-?monthly|twice a month|monthly)\b/i.exec(text);
  if (m) {
    const f = m[1].toLowerCase().replace("-", "");
    if (f === "every two weeks") return "biweekly";
    if (f === "twice a month") return "semimonthly";
    return f;
  }
  if (periodDays === undefined) return undefined;
  if (periodDays <= 8) return "weekly";
  if (periodDays <= 14) return "biweekly";
  if (periodDays <= 16) return "semimonthly";
  if (periodDays <= 31) return "monthly";
  return undefined;
}

export function parsePayStub(lines: string[]): ParsedDocument {
  const text = lines.join("\n");
  const checks: DocumentCheck[] = [];
  const issuer = valueAfter(lines, /\b(?:employer|company)(?: name)?\b\s*:/i) ?? lines.find((l) => !/(earnings statement|pay ?stub|pay statement|sample)/i.test(l))?.split(/\s{3,}/)[0];
  const payDate = dateFor(lines, /pay\s*date/i) ?? dateFor(lines, /check\s*date/i);
  const range = rangeFor(lines, /(?:pay\s*)?period(?:\s*(?:dates?|covered))?/i);
  const periodDays = range.start && range.end ? daysBetween(range.start, range.end) + 1 : undefined;
  const frequency = payFrequency(text, periodDays);

  const [gross, grossYtd] = amountsFor(lines, /gross\s*(?:pay|earnings|wages)\b/i);
  const [deductions, deductionsYtd] = amountsFor(lines, /total\s*(?:deductions|taxes\s*(?:and|&)\s*deductions|withholdings?)\b/i);
  const [net, netYtd] = amountsFor(lines, /net\s*(?:pay|amount|check)\b/i);
  const fields: Record<string, number | string> = {};
  if (gross !== undefined) fields.grossPay = gross;
  if (net !== undefined) fields.netPay = net;
  if (deductions !== undefined) fields.deductions = deductions;
  if (grossYtd !== undefined) fields.grossYtd = grossYtd;
  if (payDate) fields.payDate = payDate;
  if (frequency) fields.frequency = frequency;

  if (gross === undefined || net === undefined || !payDate) {
    checks.push(check("fields", "fail", `Couldn't read ${[gross === undefined && "gross pay", net === undefined && "net pay", !payDate && "pay date"].filter(Boolean).join(", ")}`));
  } else {
    if (net > gross) checks.push(check("net_le_gross", "fail", "Net pay is larger than gross pay"));
    if (deductions !== undefined) {
      checks.push(near(gross - deductions, net)
        ? check("arithmetic", "pass", "Gross pay minus deductions equals net pay")
        : check("arithmetic", "fail", `Gross ${money(gross)} minus deductions ${money(deductions)} doesn't equal net ${money(net)}`));
    } else checks.push(check("arithmetic", "info", "No deductions total to check against"));
    if (grossYtd !== undefined && deductionsYtd !== undefined && netYtd !== undefined) {
      checks.push(near(grossYtd - deductionsYtd, netYtd, 0.05)
        ? check("ytd_arithmetic", "pass", "Year-to-date totals add up")
        : check("ytd_arithmetic", "fail", "Year-to-date gross, deductions and net don't add up"));
    }
    if (grossYtd !== undefined && frequency) {
      const perYear = PERIODS_PER_YEAR[frequency];
      const dayOfYear = daysBetween(`${payDate.slice(0, 4)}-01-01`, payDate) + 1;
      const expectedPeriods = Math.max(1, Math.round((dayOfYear / 365) * perYear));
      const ratio = grossYtd / (gross * expectedPeriods);
      if (grossYtd < gross - 0.01) checks.push(check("ytd", "fail", "Year-to-date gross is less than this period's gross"));
      else checks.push(ratio > 1.35 || ratio < 0.5
        ? check("ytd", "warn", "Year-to-date gross doesn't fit this pay rate (new job or a raise can explain this)")
        : check("ytd", "pass", "Year-to-date gross fits this pay rate"));
    }
  }
  if (!frequency) checks.push(check("frequency", "fail", "Couldn't tell how often this person is paid"));

  const monthlyIncome = gross !== undefined && frequency ? round2((gross * PERIODS_PER_YEAR[frequency]) / 12) : undefined;
  return { kind: "pay_stub", issuer, periodStart: range.start, periodEnd: payDate ?? range.end, monthlyIncome, fields, checks };
}

// ---------------------------------------------------------------- bank statement

const TX_LINE = new RegExp(String.raw`^(\d{1,2}/\d{1,2}(?:/\d{2,4})?)\s+(.+?)\s+(\(?-?\$?[\d,]+\.\d{2}\)?)(?:\s+(\(?-?\$?[\d,]+\.\d{2}\)?))?\s*$`);
/** Payroll-like deposits. "PPD" is the ACH code banks print on direct deposits from an employer. */
const PAYROLL = /(payroll|direct\s*dep|dir\s*dep|salary|pay\s*roll|wages|ach\s*credit|\bppd\b)/i;

/** Normalize a payer description so the same employer matches across months. */
export const payerKey = (desc: string) => desc.toLowerCase().replace(/\b(ppd|id|ach|web|co|inc|llc|ref)\b[:#]?\s*\S*/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

export function parseBankStatement(lines: string[]): ParsedDocument {
  const checks: DocumentCheck[] = [];
  const issuer = lines.find((l) => /\b(bank|credit union|savings|financial)\b/i.test(l) && !/statement period/i.test(l))?.split(/\s{3,}/)[0];
  const period = rangeFor(lines, /(?:statement\s*period|for\s*the\s*period|period)/i);
  const year = period.end ? Number(period.end.slice(0, 4)) : undefined;
  const [opening] = amountsFor(lines, /(?:beginning|opening|previous)\s*balance/i).slice(-1);
  const [closing] = amountsFor(lines, /(?:ending|closing|new)\s*balance/i).slice(-1);
  const [totalDeposits] = amountsFor(lines, /total\s*(?:deposits|credits|additions)/i, { nextLine: false });
  const [totalWithdrawals] = amountsFor(lines, /total\s*(?:withdrawals|debits|checks|subtractions)/i, { nextLine: false });

  const deposits: Deposit[] = [];
  let withdrawals = 0;
  let section: "deposits" | "withdrawals" | "transactions" | null = null;
  for (const line of lines) {
    if (/^\s*total\b/i.test(line)) continue;
    if (/^(?:deposits|credits|additions)\b/i.test(line)) { section = "deposits"; continue; }
    if (/^(?:withdrawals|debits|checks|electronic\s*withdrawals|card\s*purchases|subtractions|fees)\b/i.test(line)) { section = "withdrawals"; continue; }
    if (/^(?:transactions|account\s*activity|transaction\s*detail)\b/i.test(line)) { section = "transactions"; continue; }
    if (/^(?:daily\s*balance|balance\s*summary)/i.test(line)) { section = null; continue; }
    const m = TX_LINE.exec(line);
    if (!m || !section) continue;
    const date = parseDate(m[1], year);
    const raw = moneyTokens(m[3])[0];
    if (!date || raw === undefined) continue;
    const isDeposit = section === "deposits" || (section === "transactions" && raw > 0 && !/^\(|-/.test(m[3]));
    if (isDeposit) deposits.push({ id: `stmt-${deposits.length}`, payer: m[2].trim(), amount: Math.abs(raw), date });
    else withdrawals += Math.abs(raw);
  }
  const depositSum = round2(deposits.reduce((s, d) => s + d.amount, 0));
  withdrawals = round2(withdrawals);

  if (!period.start || !period.end) checks.push(check("period", "fail", "Couldn't read the statement period"));
  if (!deposits.length) checks.push(check("deposits", "fail", "No deposits found on the statement"));
  if (totalDeposits !== undefined) {
    checks.push(near(depositSum, totalDeposits)
      ? check("deposit_total", "pass", "Deposits add up to the stated total")
      : check("deposit_total", "fail", `Listed deposits add up to ${money(depositSum)}, but the statement says ${money(totalDeposits)}`));
  }
  if (totalWithdrawals !== undefined && withdrawals > 0) {
    checks.push(near(withdrawals, totalWithdrawals)
      ? check("withdrawal_total", "pass", "Withdrawals add up to the stated total")
      : check("withdrawal_total", "fail", "Listed withdrawals don't add up to the stated total"));
  }
  if (opening !== undefined && closing !== undefined) {
    const expected = round2(opening + (totalDeposits ?? depositSum) - (totalWithdrawals ?? withdrawals));
    checks.push(near(expected, closing)
      ? check("balance", "pass", "Opening balance plus deposits minus withdrawals equals the closing balance")
      : check("balance", "fail", `Balances don't add up: expected closing ${money(expected)}, statement says ${money(closing)}`));
  } else checks.push(check("balance", "info", "No opening and closing balance to check"));

  // Recurring income: payroll-like deposits, or the same payer more than once in the period.
  const counts = new Map<string, number>();
  for (const d of deposits) counts.set(payerKey(d.payer), (counts.get(payerKey(d.payer)) ?? 0) + 1);
  const recurring = deposits.filter((d) => PAYROLL.test(d.payer) || (counts.get(payerKey(d.payer)) ?? 0) >= 2);
  const days = period.start && period.end ? daysBetween(period.start, period.end) + 1 : 30;
  const monthlyIncome = deposits.length ? round2(recurring.reduce((s, d) => s + d.amount, 0) / (days / 30.44)) : undefined;
  const fields: Record<string, number | string> = { deposits: deposits.length, recurringDeposits: recurring.length };
  if (opening !== undefined) fields.openingBalance = opening;
  if (closing !== undefined) fields.closingBalance = closing;
  return { kind: "bank_statement", issuer, periodStart: period.start, periodEnd: period.end, monthlyIncome, fields, deposits, checks };
}

// ---------------------------------------------------------------- W-2

/** Social Security wage base by tax year (box 3 can't exceed it). */
const SS_WAGE_BASE: Record<number, number> = { 2022: 147000, 2023: 160200, 2024: 168600, 2025: 176100, 2026: 184500 };

function taxYearOf(lines: string[], anchor: RegExp): number | undefined {
  for (const line of lines) if (anchor.test(line)) { const y = /\b(20\d{2})\b/.exec(line); if (y) return +y[1]; }
  const any = /\b(20[12]\d)\b/.exec(lines.join(" "));
  return any ? +any[1] : undefined;
}

export function parseW2(lines: string[]): ParsedDocument {
  const checks: DocumentCheck[] = [];
  const taxYear = taxYearOf(lines, /(wage and tax statement|form\s*w-?2)/i);
  const issuer = valueAfter(lines, /employer'?s\s*name(?:,\s*address,?\s*and\s*zip\s*code)?\b/i);
  const box = (re: RegExp) => amountsFor(lines, re)[0];
  const b1 = box(/\b1\s+wages,?\s*tips,?\s*(?:and\s*)?other\s*comp(?:ensation|\.)?/i);
  const b2 = box(/\b2\s+federal\s*income\s*tax\s*withheld/i);
  const b3 = box(/\b3\s+social\s*security\s*wages/i);
  const b4 = box(/\b4\s+social\s*security\s*tax\s*withheld/i);
  const b5 = box(/\b5\s+medicare\s*wages\s*(?:and|&)\s*tips/i);
  const b6 = box(/\b6\s+medicare\s*tax\s*withheld/i);
  const fields: Record<string, number | string> = {};
  for (const [k, v] of Object.entries({ box1: b1, box2: b2, box3: b3, box4: b4, box5: b5, box6: b6 })) if (v !== undefined) fields[k] = v;

  if (b1 === undefined) checks.push(check("fields", "fail", "Couldn't read box 1 (wages)"));
  if (!taxYear) checks.push(check("year", "fail", "Couldn't read the tax year"));
  if (b3 !== undefined && b4 !== undefined) {
    checks.push(near(b4, b3 * 0.062, 1)
      ? check("ss_tax", "pass", "Social Security tax is 6.2% of Social Security wages")
      : check("ss_tax", "fail", "Social Security tax isn't 6.2% of Social Security wages"));
  }
  if (b5 !== undefined && b6 !== undefined) {
    const base = b5 * 0.0145;
    const extra = Math.max(0, b5 - 200000) * 0.009;
    checks.push(near(b6, base + extra, 1) || near(b6, base, 1)
      ? check("medicare_tax", "pass", "Medicare tax is 1.45% of Medicare wages")
      : check("medicare_tax", "fail", "Medicare tax isn't 1.45% of Medicare wages"));
  }
  if (taxYear && b3 !== undefined && SS_WAGE_BASE[taxYear] && b3 > SS_WAGE_BASE[taxYear] + 1) {
    checks.push(check("ss_cap", "fail", `Social Security wages exceed the ${taxYear} limit`));
  }
  if (b1 !== undefined && b5 !== undefined && b1 > b5 * 1.05 + 1) checks.push(check("box1_box5", "warn", "Box 1 wages are higher than Medicare wages, which is unusual"));
  if (b1 !== undefined && b2 !== undefined && b2 > b1 * 0.5) checks.push(check("withholding", "warn", "Federal withholding is over half of wages, which is unusual"));

  return { kind: "w2", issuer, taxYear, monthlyIncome: b1 !== undefined ? round2(b1 / 12) : undefined, fields, checks };
}

// ---------------------------------------------------------------- Form 1040

/** Last amount on the line that starts with the given 1040 line number (e.g. "11"). */
function form1040Line(lines: string[], num: string, label: RegExp): number | undefined {
  const re = new RegExp(`^\\s*${num}[a-z]?\\b`, "i");
  for (const line of lines) {
    if (!re.test(line) || !label.test(line)) continue;
    const labelEnd = (label.exec(line)?.index ?? 0) + (label.exec(line)?.[0].length ?? 0);
    const nums = dollarTokens(line, labelEnd).filter((n) => n >= 0);
    if (nums.length) return nums[nums.length - 1];
  }
  return undefined;
}

export function parseForm1040(lines: string[]): ParsedDocument {
  const checks: DocumentCheck[] = [];
  const taxYear = taxYearOf(lines, /(individual income tax return|form\s*1040)/i);
  const l1z = form1040Line(lines, "1z", /add lines 1a through 1h|total.*wages|1z/i) ?? form1040Line(lines, "1", /wages/i);
  const l9 = form1040Line(lines, "9", /total income/i);
  const l10 = form1040Line(lines, "10", /adjustments/i);
  const l11 = form1040Line(lines, "11", /adjusted gross income/i);
  const l14 = form1040Line(lines, "14", /add lines 12 and 13|deductions/i);
  const l15 = form1040Line(lines, "15", /taxable income/i);
  const fields: Record<string, number | string> = {};
  for (const [k, v] of Object.entries({ line1z: l1z, line9: l9, line10: l10, line11: l11, line14: l14, line15: l15 })) if (v !== undefined) fields[k] = v;

  if (l11 === undefined) checks.push(check("fields", "fail", "Couldn't read line 11 (adjusted gross income)"));
  if (!taxYear) checks.push(check("year", "fail", "Couldn't read the tax year"));
  if (l9 !== undefined && l10 !== undefined && l11 !== undefined) {
    checks.push(near(l11, l9 - l10, 1)
      ? check("agi", "pass", "Adjusted gross income equals total income minus adjustments")
      : check("agi", "fail", "Adjusted gross income doesn't equal total income minus adjustments"));
  }
  if (l11 !== undefined && l14 !== undefined && l15 !== undefined) {
    checks.push(near(l15, Math.max(0, l11 - l14), 1)
      ? check("taxable", "pass", "Taxable income equals AGI minus deductions")
      : check("taxable", "fail", "Taxable income doesn't equal AGI minus deductions"));
  }
  if (l1z !== undefined && l9 !== undefined && l1z > l9 + 1) checks.push(check("wages_total", "fail", "Wages are larger than total income"));

  return { kind: "form_1040", issuer: "IRS Form 1040 (self-prepared)", taxYear, monthlyIncome: l11 !== undefined ? round2(l11 / 12) : undefined, fields, checks };
}

export function parseDocument(lines: string[]): ParsedDocument {
  switch (classify(lines)) {
    case "pay_stub": return parsePayStub(lines);
    case "bank_statement": return parseBankStatement(lines);
    case "w2": return parseW2(lines);
    case "form_1040": return parseForm1040(lines);
    // An ID proves age, not income. The income path leaves it out; the age path reads it with lib/documents/id-card.ts.
    case "id_card": return { kind: "id_card", fields: {}, checks: [check("kind", "fail", "A government ID isn't an income document")] };
    default: return { kind: "unknown", fields: {}, checks: [check("kind", "fail", "Not a bank statement, pay stub, W-2 or Form 1040")] };
  }
}

export { DATE_PATTERN };
