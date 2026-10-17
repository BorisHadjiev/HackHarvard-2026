import { pairwiseSubject, AGE_EVIDENCE, MIN_AGE, type ClaimPayload, type VerificationRequest } from "@ntk/shared";
import { WINDOW_DAYS, METHOD, type IncomeResult } from "./income";
import type { IntegrityResult } from "./integrity";

/** Pure, deterministic payload construction: no environment, clock, or bank access. */
export async function buildClaimPayload(
  request: VerificationRequest,
  tenant: { id: string; secret: string },
  income: IncomeResult,
  integrity: IntegrityResult,
  /** How the answer was established. Defaults to bank deposits (the original flow). */
  evidence: ClaimPayload["evidence"] = { source: "bank", strength: "bank", window_days: WINDOW_DAYS, method: METHOD },
): Promise<ClaimPayload> {
  const q = request.question;
  if (q.type !== "income_to_rent") throw new Error(`buildClaimPayload answers income questions, not ${q.type}`);
  return {
    aud: request.audience,
    nonce: request.nonce,
    sub: await pairwiseSubject(`${tenant.secret}:${tenant.id}`, request.audience),
    claim: { type: "income_to_rent", rent: q.rent, multiple: q.multiple, result: income.meets },
    evidence,
    build: { hash: integrity.hash, integrity: "passed" },
  };
}

/**
 * Age claim: same pairwise subject, build hash and fixed evidence for everyone. Takes only the
 * yes/no. The date of birth and the age never reach this function, so they can't leak from it.
 */
export async function buildAgeClaimPayload(
  request: VerificationRequest,
  tenant: { id: string; secret: string },
  isOverMinAge: boolean,
  integrity: IntegrityResult,
): Promise<ClaimPayload> {
  const q = request.question;
  if (q.type !== "age_over") throw new Error(`buildAgeClaimPayload answers age questions, not ${q.type}`);
  if (q.min_age !== MIN_AGE) throw new Error(`Only ${MIN_AGE}+ is supported`);
  return {
    aud: request.audience,
    nonce: request.nonce,
    sub: await pairwiseSubject(`${tenant.secret}:${tenant.id}`, request.audience),
    claim: { type: "age_over", min_age: MIN_AGE, result: isOverMinAge },
    evidence: AGE_EVIDENCE,
    build: { hash: integrity.hash, integrity: "passed" },
  };
}
