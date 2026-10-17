// Release manifest: a signed statement "this is an approved tenant-app build". Owner: Sam.
// Signed with a separate release key (never the claim-signing key). Rule: crypto only via `jose`.
import { SignJWT, jwtVerify, importJWK, type JWK } from "jose";
import { CLAIM_ALG } from "./claims";

export const MANIFEST_ISSUER = "need-to-know-release";
/** Distinct JWT type so a signed claim can never be passed off as a manifest (and vice versa). */
export const MANIFEST_TYP = "ntk-manifest+jwt";

export interface BuildManifest {
  /** Hash over every hashed source file, e.g. "sha256:ab12..." (see tenant-app/lib/build-hash.ts). */
  hash: string;
  /** Hash of each file by repo-relative path, so the app can say which file changed. */
  files: Record<string, string>;
}

/** Sign a manifest with the release private key. Returns a compact JWS string. */
export async function signManifest(manifest: BuildManifest, releasePrivateJwk: JWK, now = new Date()): Promise<string> {
  const key = await importJWK(releasePrivateJwk, CLAIM_ALG);
  return new SignJWT({ hash: manifest.hash, files: manifest.files })
    .setProtectedHeader({ alg: CLAIM_ALG, typ: MANIFEST_TYP })
    .setIssuer(MANIFEST_ISSUER)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .sign(key);
}

/** Verify a manifest against the release public key. Throws if the signature, issuer, type or shape is wrong. */
export async function verifyManifest(jws: string, releasePublicJwk: JWK): Promise<BuildManifest> {
  const key = await importJWK(releasePublicJwk, CLAIM_ALG);
  const { payload } = await jwtVerify(jws, key, { algorithms: [CLAIM_ALG], issuer: MANIFEST_ISSUER, typ: MANIFEST_TYP });
  const { hash, files } = payload as Record<string, unknown>;
  if (typeof hash !== "string" || !files || typeof files !== "object" || Array.isArray(files)) {
    throw new Error("Manifest is missing its hash or file list");
  }
  for (const v of Object.values(files)) if (typeof v !== "string") throw new Error("Manifest file list is malformed");
  return { hash, files: files as Record<string, string> };
}
