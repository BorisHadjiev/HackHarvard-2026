// Turns the existing document scan into the only outcome the portal may learn.
// The scan itself stays in lib/documents/analyze.ts. This file does not read files.
import type { ClaimPayload } from "@ntk/shared";
import { DOCUMENT_METHOD, DOCUMENT_WINDOW_DAYS } from "./documents/analyze";
import type { DocumentDecision } from "./documents/types";

export type ScanDelivery =
  | { outcome: "accepted"; action: "sign"; meets: true; evidence: ClaimPayload["evidence"] }
  | { outcome: "declined"; action: "sign"; meets: false; evidence: ClaimPayload["evidence"] }
  | { outcome: "declined"; action: "decline" };

/**
 * Accepted when the scanner counted the documents and income meets the question.
 * A counted document that falls short is still a signed no.
 * A document the scanner rejected has no income answer, so the portal is only told "declined".
 */
export function deliveryFromScan(decision: Pick<DocumentDecision, "meets" | "strength">): ScanDelivery {
  if (!decision.strength) return { outcome: "declined", action: "decline" };
  const evidence: ClaimPayload["evidence"] = {
    source: "document",
    strength: decision.strength,
    window_days: DOCUMENT_WINDOW_DAYS,
    method: DOCUMENT_METHOD,
  };
  if (decision.meets) return { outcome: "accepted", action: "sign", meets: true, evidence };
  return { outcome: "declined", action: "sign", meets: false, evidence };
}

/** Posted when the scan declines and there is nothing to sign. No document and no amounts. */
export function declineNotice(requestId: string): { requestId: string; declined: true } {
  return { requestId, declined: true };
}
