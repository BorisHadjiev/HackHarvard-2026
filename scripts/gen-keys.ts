// Generates the tenant app's Ed25519 signing key pair and writes it into each app's .env.local.
// Run once after cloning: `npm run keys`. Re-running replaces the keys (old claims stop verifying).
import { randomBytes } from "node:crypto";
import { generateSigningKeys } from "../shared/src/claims";
import { upsertEnv } from "./env-file";

const { privateJwk, publicJwk } = await generateSigningKeys();
// The stand-in bank's key: separate from the tenant app's, trusted by the landlord portal.
const bank = await generateSigningKeys();

upsertEnv("tenant-app/.env.local", {
  TENANT_APP_PRIVATE_JWK: `'${JSON.stringify(privateJwk)}'`,
  TENANT_SECRET: randomBytes(16).toString("hex"),
  DEFAULT_PORTAL_URL: "http://localhost:3000",
  BANK_SIGNER_URL: "http://localhost:3002",
});
upsertEnv("bank-signer/.env.local", {
  BANK_SIGNER_PRIVATE_JWK: `'${JSON.stringify(bank.privateJwk)}'`,
});
upsertEnv("landlord-portal/.env.local", {
  TENANT_APP_PUBLIC_JWK: `'${JSON.stringify(publicJwk)}'`,
  TENANT_APP_URL: "http://localhost:3001",
  PORTAL_AUDIENCE: "landlord-portal",
  TRUSTED_BANK_KEYS: `'${JSON.stringify([bank.publicJwk])}'`,
});

console.log("Wrote tenant-app/.env.local, landlord-portal/.env.local and bank-signer/.env.local (all git-ignored).");
console.log("Add NESSIE_API_KEY etc. to tenant-app/.env.local yourself; this script keeps other lines.");
