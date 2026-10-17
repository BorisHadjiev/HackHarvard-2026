// Reading amounts and dates the way they appear on statements, pay stubs and tax forms.
// OCR output is cleaned first (common misreads like O for 0 inside numbers).

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Fix common OCR misreads inside numbers and normalize spacing. */
export function cleanOcrLine(line: string): string {
  return line
    .replace(/[|]/g, " ")
    .replace(/(?<=[\d,.$])[Oo](?=[\d,.])/g, "0")
    .replace(/(?<=\d)[Oo]\b/g, "0")
    .replace(/(?<=[\d,])[lI](?=\d)/g, "1")
    .replace(/\bS(?=\d{1,3}(?:,\d{3})*\.\d{2}\b)/g, "$")
    .replace(/(?<=\d) (?=\d{3}\.\d{2}\b)/g, ",") // "4 100.00" -> "4,100.00"
    .replace(/(?<=\d), (?=\d{3}\b)/g, ",")
    .replace(/(?<=\d) \. ?(?=\d{2}\b)/g, ".")
    .replace(/\s+/g, (space) => space.length >= 3 ? "   " : " ")
    .trim();
}

const MONEY = /\(?[+-]?\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?/g;
const WHOLE_DOLLARS = /\(?[+-]?\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?\)?(?![\d/])/g;

export function parseMoney(token: string): number {
  const negative = /^\(.*\)$/.test(token.trim()) || token.includes("-");
  const n = Number(token.replace(/[^\d.]/g, ""));
  return negative ? -n : n;
}

/** Amounts with cents (e.g. 4,100.00) appearing after `from` in the line. */
export function moneyTokens(line: string, from = 0): number[] {
  return [...line.slice(from).matchAll(MONEY)].map((m) => parseMoney(m[0]));
}

/** Amounts with or without cents (tax forms often use whole dollars), skipping dates. */
export function dollarTokens(line: string, from = 0): number[] {
  return [...line.slice(from).matchAll(WHOLE_DOLLARS)].map((m) => parseMoney(m[0])).filter((n) => Number.isFinite(n));
}

/** Find the first line matching `label` and return the amounts after the label (or on the next line). */
export function amountsFor(lines: string[], label: RegExp, opts: { wholeDollars?: boolean; nextLine?: boolean } = {}): number[] {
  const read = opts.wholeDollars ? dollarTokens : moneyTokens;
  for (let i = 0; i < lines.length; i++) {
    const m = label.exec(lines[i]);
    if (!m) continue;
    // A summary can print labels across one row and amounts across the next.
    // Read the matching column, never another label's amount.
    const columns = lines[i].trim().split(/\s{3,}/);
    const values = lines[i + 1]?.trim().split(/\s{3,}/) ?? [];
    if (columns.length > 1 && !read(lines[i]).length && values.some((v) => read(v).length)) {
      const column = columns.findIndex((c) => label.test(c));
      if (values.length !== columns.length || !values.every((v) => read(v).length === 1 && !/[a-z]/i.test(v))) return [];
      return column >= 0 ? read(values[column]) : [];
    }
    const found = read(lines[i], m.index + m[0].length);
    if (found.length) return found;
    if (opts.nextLine !== false && i + 1 < lines.length) {
      const next = read(lines[i + 1]);
      if (next.length) return next;
    }
  }
  return [];
}

export const DATE_PATTERN = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}(?:/\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.? \d{1,2}(?:,? \d{4})?)`;

/** Parse a date like 10/03/2026, 10/3/26, 2026-10-03 or "Oct 3, 2026" into YYYY-MM-DD; short dates need defaultYear. */
export function parseDate(s: string, defaultYear?: number): string | undefined {
  const t = s.trim().toLowerCase();
  let y: number, mo: number, d: number;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t))) {
    mo = +m[1];
    d = +m[2];
    if (m[3]) y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    else if (defaultYear) y = defaultYear;
    else return undefined;
  } else if ((m = /^([a-z]+)\.? (\d{1,2})(?:,? (\d{4}))?$/.exec(t)) && MONTHS[m[1].slice(0, 3)]) {
    mo = MONTHS[m[1].slice(0, 3)];
    d = +m[2];
    if (m[3]) y = +m[3];
    else if (defaultYear) y = defaultYear;
    else return undefined;
  } else return undefined;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return undefined; // e.g. Sept 31
  return date.toISOString().slice(0, 10);
}

/** First date found after `label` in any line. */
export function dateFor(lines: string[], label: RegExp, defaultYear?: number): string | undefined {
  const re = new RegExp(`${label.source}\\s*:?\\s*(${DATE_PATTERN})`, "i");
  for (const line of lines) {
    const m = re.exec(line);
    if (m) return parseDate(m[m.length - 1], defaultYear);
  }
  return undefined;
}

/** A date range like "Statement Period: 09/01/2026 - 09/30/2026". */
export function rangeFor(lines: string[], label: RegExp): { start?: string; end?: string } {
  const re = new RegExp(`${label.source}\\s*:?\\s*(${DATE_PATTERN})\\s*(?:-|–|to|through|thru)\\s*(${DATE_PATTERN})`, "i");
  for (const line of lines) {
    const m = re.exec(line);
    if (m) return { start: parseDate(m[1]), end: parseDate(m[2]) };
  }
  return {};
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
export const near = (a: number, b: number, tolerance = 0.02) => Math.abs(a - b) <= tolerance + 1e-9;
export const round2 = (n: number) => Math.round(n * 100) / 100;
