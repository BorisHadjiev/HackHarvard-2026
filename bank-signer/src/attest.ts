// Bank attestation: the bank's signature over a commitment to a tenant's deposit list. Owner: Sam.
// Stand-in for what a real bank (or an open-banking provider) would sign. Its key is separate from
// the tenant app's key, and the tenant never holds it. Crypto via `jose` only.
import { SignJWT, jwtVerify, importJWK, type JWK } from "jose";

export const BANK_ALG = "EdDSA";
export const BANK_ISSUER = "need-to-know-bank-signer";
export const BANK_TYP = "ntk-bank-attestation+jwt";
/** An attestation is only good for a short while: it describes "the deposits as of today". */
export const BANK_TTL_SECONDS = 24 * 60 * 60;
/** iat is rounded down to the UTC day, like claims, so attestations don't carry exact times. */
const DAY = 24 * 60 * 60;

export interface BankAttestationPayload {
  /** Pedersen commitment the circuit will be held to. Salted per request; carries no account data. */
  commitment: string;
  /** Day number the deposits were read on. The proof's `today` must match it. */
  asOfDay: number;
  /** Which proving circuit this list is formatted for (hash of its verification key). */
  circuit: string;
}

export async function signAttestation(payload: BankAttestationPayload, bankPrivateJwk: JWK, now = new Date()): Promise<string> {
  const key = await importJWK(bankPrivateJwk, BANK_ALG);
  const iat = Math.floor(now.getTime() / 1000 / DAY) * DAY;
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: BANK_ALG, typ: BANK_TYP })
    .setIssuer(BANK_ISSUER)
    .setIssuedAt(iat)
    .setExpirationTime(iat + DAY + BANK_TTL_SECONDS)
    .sign(key);
}

/** Verify against any of the trusted bank keys. Throws if none accept it. */
export async function verifyAttestation(jws: string, trustedBankKeys: JWK[], now = new Date()): Promise<BankAttestationPayload> {
  let lastError: unknown = new Error("no trusted bank keys configured");
  for (const jwk of trustedBankKeys) {
    try {
      const key = await importJWK(jwk, BANK_ALG);
      const { payload } = await jwtVerify(jws, key, { algorithms: [BANK_ALG], issuer: BANK_ISSUER, typ: BANK_TYP, currentDate: now });
      const { commitment, asOfDay, circuit } = payload as Record<string, unknown>;
      if (typeof commitment !== "string" || typeof asOfDay !== "number" || typeof circuit !== "string") throw new Error("malformed attestation");
      return { commitment, asOfDay, circuit };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
