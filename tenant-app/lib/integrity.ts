// Tamper check. Owner: Sam.
// Before signing, hash the app's own code and compare it with a release manifest signed by a
// separate release key (`npm run sign-manifest`). If anything changed, refuse to sign.
// The landlord portal independently only accepts claims whose build hash is in TRUSTED_BUILD_HASHES.
// Pitch note: this is a software check; production would use hardware attestation (App Attest / Play Integrity).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { verifyManifest, type JWK } from "@ntk/shared";
import { changedFiles, findRepoRoot, hashSourceFiles } from "./build-hash";

export interface IntegrityResult {
  passed: boolean;
  hash: string;
  reason?: string;
}

/** Hash reported by a dev build that was never signed. A portal with TRUSTED_BUILD_HASHES set rejects it. */
export const UNSIGNED_DEV_HASH = "unsigned-dev-build";
export const MANIFEST_FILE = "tenant-app/build-manifest.json";

export interface IntegrityOptions {
  /** Repo root (folder holding tenant-app/ and shared/). */
  root: string;
  /** Release public key that signed the manifest. */
  releasePublicJwk?: JWK;
  /** If true, a missing manifest fails instead of falling back to an unsigned dev build. */
  requireSigned: boolean;
}

export async function checkIntegrity(): Promise<IntegrityResult> {
  const raw = process.env.RELEASE_PUBLIC_JWK;
  let releasePublicJwk: JWK | undefined;
  try {
    releasePublicJwk = raw ? (JSON.parse(raw) as JWK) : undefined;
  } catch {
    return { passed: false, hash: UNSIGNED_DEV_HASH, reason: "RELEASE_PUBLIC_JWK is not valid JSON; refusing to sign" };
  }
  let root: string;
  try {
    root = findRepoRoot();
  } catch (err) {
    return { passed: false, hash: UNSIGNED_DEV_HASH, reason: `${(err as Error).message}; refusing to sign` };
  }
  return checkIntegrityAt({ root, releasePublicJwk, requireSigned: process.env.REQUIRE_SIGNED_BUILD === "1" });
}

/** The check itself, with its inputs passed in (so tests can run it against a temp folder). */
export async function checkIntegrityAt(opts: IntegrityOptions): Promise<IntegrityResult> {
  const current = hashSourceFiles(opts.root);
  const manifestPath = path.join(opts.root, MANIFEST_FILE);

  if (!existsSync(manifestPath)) {
    if (opts.requireSigned) {
      return { passed: false, hash: current.hash, reason: "No signed release manifest found; refusing to sign. Run `npm run sign-manifest`." };
    }
    return { passed: true, hash: UNSIGNED_DEV_HASH, reason: "Unsigned dev build (run `npm run sign-manifest` to enable the tamper check)" };
  }
  if (!opts.releasePublicJwk) {
    return { passed: false, hash: current.hash, reason: "RELEASE_PUBLIC_JWK is not set, so the release manifest can't be checked; refusing to sign" };
  }

  let approved;
  try {
    const { jws } = JSON.parse(readFileSync(manifestPath, "utf8")) as { jws?: unknown };
    approved = await verifyManifest(String(jws ?? ""), opts.releasePublicJwk);
  } catch {
    return { passed: false, hash: current.hash, reason: "Release manifest signature is invalid; refusing to sign" };
  }

  if (approved.hash !== current.hash) {
    const changed = changedFiles(approved.files, current.files);
    const shown = changed.slice(0, 3).join(", ") + (changed.length > 3 ? ` and ${changed.length - 3} more` : "");
    return { passed: false, hash: current.hash, reason: `App code was modified (${shown || "unknown file"}); refusing to sign` };
  }
  return { passed: true, hash: current.hash };
}
