import { pairwiseSubject, type ClaimPayload, type VerificationRequest } from "@ntk/shared";
import { WINDOW_DAYS, METHOD, type IncomeResult } from "./income";
import type { IntegrityResult } from "./integrity";

/** Pure, deterministic payload construction: no environment, clock, or bank access. */
export async function buildClaimPayload(
  request: VerificationRequest,
  tenant: { id: string; secret: string },
  income: IncomeResult,
  integrity: IntegrityResult,
): Promise<ClaimPayload> {
  return {
    aud: request.audience,
    nonce: request.nonce,
    sub: await pairwiseSubject(`${tenant.secret}:${tenant.id}`, request.audience),
    claim: { type: "income_to_rent", rent: request.question.rent, multiple: request.question.multiple, result: income.meets },
    evidence: { source: "bank", window_days: WINDOW_DAYS, method: METHOD },
    build: { hash: integrity.hash, integrity: "passed" },
  };
}
