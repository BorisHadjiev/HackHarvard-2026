// Income check. Owner: Angelo. Pure function: easy to unit test (see test/income.test.ts).
import type { Deposit } from "./nessie";

export const WINDOW_DAYS = 90;
export const METHOD = "recurring deposits, median month";

export interface IncomeResult {
  /** Does median monthly recurring income meet multiple x rent? */
  meets: boolean;
  /** Kept on the tenant's machine only. Never put this in the signed claim. */
  medianMonthlyIncome: number;
  recurringPayers: string[];
}

/**
 * Baseline rule (Angelo, refine this):
 * 1. Keep deposits from the last 90 days.
 * 2. Keep only "recurring" payers: the same payer at least 3 times in the window
 *    (blocks a one-time transfer the day before applying).
 * 3. Split the window into three 30-day months, total each, take the median.
 * 4. Pass if median >= multiple x rent.
 */
export function evaluateIncome(deposits: Deposit[], rent: number, multiple: number, now = new Date()): IncomeResult {
  const start = now.getTime() - WINDOW_DAYS * 86_400_000;
  const inWindow = deposits.filter((d) => Date.parse(d.date) >= start && Date.parse(d.date) <= now.getTime());

  const counts = new Map<string, number>();
  for (const d of inWindow) counts.set(d.payer, (counts.get(d.payer) ?? 0) + 1);
  const recurringPayers = [...counts].filter(([, n]) => n >= 3).map(([p]) => p);
  const recurring = inWindow.filter((d) => recurringPayers.includes(d.payer));

  const months = [0, 0, 0];
  for (const d of recurring) {
    const daysAgo = (now.getTime() - Date.parse(d.date)) / 86_400_000;
    const bucket = Math.min(2, Math.floor(daysAgo / 30));
    months[bucket] += d.amount;
  }
  const medianMonthlyIncome = [...months].sort((a, b) => a - b)[1];

  return { meets: medianMonthlyIncome >= multiple * rent, medianMonthlyIncome, recurringPayers };
}
