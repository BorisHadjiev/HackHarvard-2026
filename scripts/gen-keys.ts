// Generates the tenant app's Ed25519 signing key pair and writes it into each app's .env.local.
// Run once after cloning: `npm run keys`. Re-running replaces the keys (old claims stop verifying).
import { randomBytes } from "node:crypto";
import { generateSigningKeys } from "../shared/src/claims";
import { upsertEnv } from "./env-file";

const { privateJwk, publicJwk } = await generateSigningKeys();

upsertEnv("tenant-app/.env.local", {
  TENANT_APP_PRIVATE_JWK: `'${JSON.stringify(privateJwk)}'`,
  TENANT_SECRET: randomBytes(16).toString("hex"),
  DEFAULT_PORTAL_URL: "http://localhost:3000",
});
upsertEnv("landlord-portal/.env.local", {
  TENANT_APP_PUBLIC_JWK: `'${JSON.stringify(publicJwk)}'`,
  TENANT_APP_URL: "http://localhost:3001",
  PORTAL_AUDIENCE: "landlord-portal",
});

console.log("Wrote tenant-app/.env.local and landlord-portal/.env.local (both git-ignored).");
console.log("Add NESSIE_API_KEY etc. to tenant-app/.env.local yourself; this script keeps other lines.");
