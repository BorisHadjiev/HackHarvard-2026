// Check a zero-knowledge income proof against the bank's signed commitment. Owner: Sam.
// The portal never sees deposits: it sees the bank's signature over a commitment, and a proof
// that the rule holds for the list behind that commitment, bound to this exact request.
import type { JWK, VerificationRequest } from "@ntk/shared";
import { circuitId, dayNumber, requestTag, verifyIncomeProof } from "@ntk/zk";
import { verifyAttestation } from "@ntk/bank-signer";

export type ProofCheck = { ok: true; result: boolean } | { ok: false; code: "bad_bank_attestation" | "wrong_circuit" | "stale_attestation" | "bad_proof"; message: string };

export function looksLikeProof(zk: unknown): zk is { proof: string; publicInputs: string[]; attestation: string } {
  if (!zk || typeof zk !== "object") return false;
  const z = zk as Record<string, unknown>;
  return typeof z.proof === "string" && Array.isArray(z.publicInputs) && z.publicInputs.every((x) => typeof x === "string") && typeof z.attestation === "string";
}

export async function checkProof(zk: { proof: string; publicInputs: string[]; attestation: string }, request: VerificationRequest, trustedBankKeys: JWK[], now = new Date()): Promise<ProofCheck> {
  let att;
  try {
    att = await verifyAttestation(zk.attestation, trustedBankKeys, now);
  } catch (err) {
    return { ok: false, code: "bad_bank_attestation", message: `The bank's signature didn't check out (${(err as Error).message})` };
  }
  if (att.circuit !== circuitId()) return { ok: false, code: "wrong_circuit", message: "The bank signed for a different proving circuit" };
  // The bank vouches for the date it read the deposits. It must be between the request and now.
  const today = dayNumber(now.toISOString());
  if (att.asOfDay > today + 1 || att.asOfDay < dayNumber(request.createdAt) - 1) {
    return { ok: false, code: "stale_attestation", message: "The bank's attestation is not from this request's time window" };
  }
  // The circuit proves the income rule; an age request has no rent or multiple to bind to.
  if (request.question.type !== "income_to_rent") return { ok: false, code: "bad_proof", message: "A zero-knowledge income proof doesn't answer this question" };
  const outcome = await verifyIncomeProof({ proof: zk.proof, publicInputs: zk.publicInputs }, {
    commitment: att.commitment,
    today: att.asOfDay,
    rentCents: Math.round(request.question.rent * 100),
    multipleX100: Math.round(request.question.multiple * 100),
    requestTag: requestTag(request.nonce),
  });
  if (!outcome.valid) return { ok: false, code: "bad_proof", message: outcome.reason };
  return { ok: true, result: outcome.result };
}
