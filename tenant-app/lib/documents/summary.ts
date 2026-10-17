// What the tenant's own screen shows about each document. Stays on this device.
import { KIND_LABELS, type DocumentDecision } from "./types";

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
