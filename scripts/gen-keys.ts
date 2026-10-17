// Generates the tenant app's Ed25519 signing key pair and writes it into each app's .env.local.
// Run after cloning: `npm run keys`. Keys that already exist are kept (so a public key you put on
// Render stays valid); pass `--rotate` to replace them all (old claims then stop verifying).
import { randomBytes } from "node:crypto";
import { generateSigningKeys } from "../shared/src/claims";
import { upsertEnv } from "./env-file";

import { existsSync, readFileSync } from "node:fs";
function readEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).replace(/^'(.*)'$/, "$1")];
  }));
}
const rotate = process.argv.includes("--rotate");
const tenantEnv = readEnv("tenant-app/.env.local");
const portalEnv = readEnv("landlord-portal/.env.local");
const bankEnv = readEnv("bank-signer/.env.local");

// Tenant app signing key: keep the existing pair unless asked to rotate.
let { privateJwk, publicJwk } = await generateSigningKeys();
if (!rotate && tenantEnv.TENANT_APP_PRIVATE_JWK && portalEnv.TENANT_APP_PUBLIC_JWK) {
  privateJwk = JSON.parse(tenantEnv.TENANT_APP_PRIVATE_JWK);
  publicJwk = JSON.parse(portalEnv.TENANT_APP_PUBLIC_JWK);
  console.log("Kept the existing tenant signing key (use --rotate to replace it).");
}
// The stand-in bank's key: separate from the tenant app's, trusted by the landlord portal.
let bank = await generateSigningKeys();
if (!rotate && bankEnv.BANK_SIGNER_PRIVATE_JWK && portalEnv.TRUSTED_BANK_KEYS) {
  bank = { privateJwk: JSON.parse(bankEnv.BANK_SIGNER_PRIVATE_JWK), publicJwk: JSON.parse(portalEnv.TRUSTED_BANK_KEYS)[0] };
  console.log("Kept the existing bank signer key.");
}

upsertEnv("tenant-app/.env.local", {
  TENANT_APP_PRIVATE_JWK: `'${JSON.stringify(privateJwk)}'`,
  TENANT_SECRET: !rotate && tenantEnv.TENANT_SECRET ? tenantEnv.TENANT_SECRET : randomBytes(16).toString("hex"),
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
