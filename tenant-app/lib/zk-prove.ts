// Zero-knowledge path for bank-backed answers. Owner: Sam.
// 1. Ask the bank to sign a commitment to the deposits (with a fresh per-request salt).
// 2. Prove, on this device, that the rule holds for exactly those deposits.
// 3. Send the landlord the proof + the bank's signature. Never the deposits.
import { decodeJwt } from "jose";
import { newSalt, proveIncome, requestTag, type ZkDeposit } from "@ntk/zk";
import type { VerificationRequest } from "@ntk/shared";

export interface ZkEvidence {
  proof: string;
  publicInputs: string[];
  attestation: string;
}

export class BankSignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BankSignerError";
  }
}

export async function proveWithBank(bankSignerUrl: string, account: string, request: VerificationRequest): Promise<{ zk: ZkEvidence; result: boolean; source: string; provingMs: number }> {
  const salt = newSalt();
  let res: Response;
  try {
    res = await fetch(`${bankSignerUrl.replace(/\/+$/, "")}/attest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account, salt: salt.toString() }),
      cache: "no-store",
    });
  } catch {
    throw new BankSignerError(`The bank signer at ${bankSignerUrl} isn't reachable`);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; source?: string; attestation?: string; deposits?: { amountCents: number; day: number; payer: string }[] };
  if (!res.ok || !body.attestation || !body.deposits) throw new BankSignerError(body.error ?? `Bank signer returned ${res.status}`);

  const att = decodeJwt(body.attestation) as { commitment?: string; asOfDay?: number };
  if (typeof att.commitment !== "string" || typeof att.asOfDay !== "number") throw new BankSignerError("Bank attestation is malformed");
  const deposits: ZkDeposit[] = body.deposits.map((d) => ({ amountCents: d.amountCents, day: d.day, payer: BigInt(d.payer) }));

  const q = request.question;
  if (q.type !== "income_to_rent") throw new BankSignerError("A zero-knowledge income proof only answers income questions");
  const t0 = Date.now();
  const proof = await proveIncome(deposits, salt, {
    commitment: att.commitment,
    today: att.asOfDay,
    rentCents: Math.round(q.rent * 100),
    multipleX100: Math.round(q.multiple * 100),
    requestTag: requestTag(request.nonce),
  });
  return {
    zk: { proof: proof.proof, publicInputs: proof.publicInputs, attestation: body.attestation },
    result: proof.result,
    source: body.source ?? "bank",
    provingMs: Date.now() - t0,
  };
}
