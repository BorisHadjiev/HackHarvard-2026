// Approve the current tenant-app code as a release build. Owner: Sam.
//   npm run sign-manifest            hash the code, sign it with the release key, trust that hash on the portal
//   npm run sign-manifest -- --reset go back to an unsigned dev build (removes the manifest and the env lines)
// Re-run after every change to tenant-app/ or shared/src, or Approve will refuse to sign.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateSigningKeys, signManifest, type JWK } from "../shared/src/index";
import { findRepoRoot, hashSourceFiles } from "../tenant-app/lib/build-hash";
import { MANIFEST_FILE } from "../tenant-app/lib/integrity";
import { upsertEnv } from "./env-file";

const root = findRepoRoot();
const tenantEnv = path.join(root, "tenant-app/.env.local");
const portalEnv = path.join(root, "landlord-portal/.env.local");
const manifestPath = path.join(root, MANIFEST_FILE);

if (process.argv.includes("--reset")) {
  rmSync(manifestPath, { force: true });
  upsertEnv(tenantEnv, { RELEASE_PUBLIC_JWK: undefined, REQUIRE_SIGNED_BUILD: undefined });
  upsertEnv(portalEnv, { TRUSTED_BUILD_HASHES: undefined });
  console.log("Back to an unsigned dev build: tamper check off, portal accepts any build hash.");
  console.log("Restart `npm run dev` if it was running.");
  process.exit(0);
}

// The release key is separate from the claim-signing key and lives only in git-ignored .keys/.
const keyDir = path.join(root, ".keys");
const keyPath = path.join(keyDir, "release-private.jwk");
let releasePrivate: JWK;
if (existsSync(keyPath)) {
  releasePrivate = JSON.parse(readFileSync(keyPath, "utf8")) as JWK;
} else {
  mkdirSync(keyDir, { recursive: true });
  releasePrivate = (await generateSigningKeys()).privateJwk;
  writeFileSync(keyPath, JSON.stringify(releasePrivate), { mode: 0o600 });
  console.log(`Created a new release key in ${path.relative(root, keyPath)} (git-ignored).`);
}
const releasePublic: JWK = { kty: releasePrivate.kty, crv: releasePrivate.crv, x: releasePrivate.x };

const source = hashSourceFiles(root);
const jws = await signManifest(source, releasePrivate);
writeFileSync(manifestPath, JSON.stringify({ version: 1, hash: source.hash, fileCount: Object.keys(source.files).length, jws }, null, 2) + "\n");

upsertEnv(tenantEnv, { RELEASE_PUBLIC_JWK: `'${JSON.stringify(releasePublic)}'`, REQUIRE_SIGNED_BUILD: "1" });
upsertEnv(portalEnv, { TRUSTED_BUILD_HASHES: source.hash });

console.log(`Signed ${Object.keys(source.files).length} files.`);
console.log(`Build hash: ${source.hash}`);
console.log(`Wrote ${MANIFEST_FILE}, RELEASE_PUBLIC_JWK + REQUIRE_SIGNED_BUILD=1 in tenant-app/.env.local,`);
console.log(`and TRUSTED_BUILD_HASHES in landlord-portal/.env.local.`);
console.log("Demo: edit any line in tenant-app/lib/income.ts, then Approve fails with \"refusing to sign\".");
