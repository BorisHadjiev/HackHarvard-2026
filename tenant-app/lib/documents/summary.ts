// What the tenant's own screen shows about each document. Stays on this device.
import { KIND_LABELS, type DocumentDecision } from "./types";
import type { AgeDecision } from "./analyze";

export function summarizeDecision(d: DocumentDecision) {
  return {
    monthlyIncome: d.monthlyIncome,
    meets: d.meets,
    strength: d.strength,
    reason: d.reason,
    counted: d.counted,
    documents: d.reports.map((r) => ({
      fileName: r.fileName,
      kind: KIND_LABELS[r.kind],
      issuer: r.issuer,
      date: r.periodEnd ?? (r.taxYear ? `Tax year ${r.taxYear}` : undefined),
      monthlyIncome: r.monthlyIncome,
      readMethod: r.readMethod,
      bankMatch: r.bankMatch,
      signature: r.signature,
      usable: r.usable,
      counted: d.counted.includes(r.fileName),
      checks: r.checks,
    })),
  };
}
export type DecisionSummary = ReturnType<typeof summarizeDecision>;

/** Age check, for the tenant's screen: check labels and pass/fail only. No date of birth, age or issuer. */
export function summarizeAge(d: AgeDecision) {
  return {
    meets: d.meets,
    usable: d.usable,
    reason: d.reason,
    documents: d.reports.map((r) => ({
      fileName: r.fileName,
      kind: KIND_LABELS[r.kind],
      readMethod: r.readMethod,
      usable: r.usable,
      checks: r.checks.map((c) => ({ id: c.id, status: c.status, label: c.label })),
    })),
  };
}
export type AgeSummary = ReturnType<typeof summarizeAge>;
