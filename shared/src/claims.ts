// Signing and verifying claims. Owner: Sam.
// Rule: never hand-roll crypto. Everything goes through `jose`.
import { SignJWT, jwtVerify, importJWK, generateKeyPair, exportJWK, type JWK } from "jose";
import type { ClaimPayload, VerifiedClaim } from "./types";

export const CLAIM_ALG = "EdDSA"; // Ed25519 keys
export const CLAIM_ISSUER = "need-to-know-tenant-app";
/** How long a signed claim stays valid. */
export const CLAIM_TTL_SECONDS = 7 * 24 * 60 * 60;

export type ClaimErrorCode =
  | "bad_signature"
  | "wrong_audience"
  | "wrong_nonce"
  | "expired"
  | "untrusted_build"
  | "malformed";

export class ClaimError extends Error {
  constructor(public code: ClaimErrorCode, message: string) {
    super(message);
    this.name = "ClaimError";
  }
}

/** Generate an Ed25519 key pair as JWKs (used by scripts/gen-keys.ts). */
export async function generateSigningKeys(): Promise<{ privateJwk: JWK; publicJwk: JWK }> {
  const { privateKey, publicKey } = await generateKeyPair(CLAIM_ALG, { crv: "Ed25519", extractable: true });
  return { privateJwk: await exportJWK(privateKey), publicJwk: await exportJWK(publicKey) };
}

/** Sign a claim with the tenant app's private key. Returns a compact JWS string. */
export async function signClaim(payload: ClaimPayload, privateJwk: JWK, now = new Date()): Promise<string> {
  const key = await importJWK(privateJwk, CLAIM_ALG);
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: CLAIM_ALG, typ: "JWT" })
    .setIssuer(CLAIM_ISSUER)
    .setIssuedAt(iat)
    .setExpirationTime(iat + CLAIM_TTL_SECONDS)
    .sign(key);
}

export interface VerifyOptions {
  /** The portal's own audience id. */
  audience: string;
  /** The one-time code of the open request this claim answers. */
  expectedNonce: string;
  /** Build hashes of approved tenant-app builds. Empty array = skip check (dev only). */
  trustedBuildHashes: string[];
  now?: Date;
}

/**
 * Verify a claim. Checks, in order: signature, audience, expiry, nonce, trusted build.
 * Replay (the same nonce used twice) is checked by the caller, which owns storage.
 */
export async function verifyClaim(token: string, publicJwk: JWK, opts: VerifyOptions): Promise<VerifiedClaim> {
  const key = await importJWK(publicJwk, CLAIM_ALG);
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, key, {
      algorithms: [CLAIM_ALG],
      issuer: CLAIM_ISSUER,
      audience: opts.audience,
      currentDate: opts.now,
    });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ERR_JWT_EXPIRED") throw new ClaimError("expired", "Claim has expired");
    if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && (err as { claim?: string }).claim === "aud") {
      throw new ClaimError("wrong_audience", "Claim was issued for a different verifier");
    }
    if (code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") throw new ClaimError("bad_signature", "Signature is invalid");
    throw new ClaimError("malformed", `Claim could not be verified: ${(err as Error).message}`);
  }

  const claim = payload as unknown as VerifiedClaim;
  if (claim.nonce !== opts.expectedNonce) throw new ClaimError("wrong_nonce", "Claim does not answer this request");
  if (opts.trustedBuildHashes.length > 0 && !opts.trustedBuildHashes.includes(claim.build?.hash)) {
    throw new ClaimError("untrusted_build", "Claim came from an unapproved build of the tenant app");
  }
  return claim;
}

/**
 * Pairwise subject: a stable ID per (tenant, landlord) pair, so two landlords
 * can't link the same tenant. HMAC-SHA256(tenantSecret, audience), hex.
 */
export async function pairwiseSubject(tenantSecret: string, audience: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(tenantSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(audience)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}
