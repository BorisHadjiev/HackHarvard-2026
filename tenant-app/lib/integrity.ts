// Tamper check. Owner: Sam.
// Goal: at startup, hash the app's own code and compare with a signed list of approved
// builds. If it doesn't match, refuse to run and refuse to sign.
//
// TODO(Sam):
// 1. scripts/sign-manifest.ts: hash the tenant-app source files (sha256 over sorted
//    file contents), sign {hash} with a separate "release" key, write build-manifest.json.
// 2. Here: recompute the hash, verify the manifest signature, compare.
// 3. Put the approved hash in landlord-portal TRUSTED_BUILD_HASHES.
// Pitch note: production would use hardware attestation (App Attest / Play Integrity).

export interface IntegrityResult {
  passed: boolean;
  hash: string;
  reason?: string;
}

export async function checkIntegrity(): Promise<IntegrityResult> {
  // Placeholder: always passes with a fixed dev hash.
  return { passed: true, hash: process.env.BUILD_HASH ?? "dev-build" };
}
