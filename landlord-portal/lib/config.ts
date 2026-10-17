import type { JWK } from "@ntk/shared";

// Values come from landlord-portal/.env.local, written by `npm run keys`.
export function portalConfig() {
  const raw = process.env.TENANT_APP_PUBLIC_JWK;
  if (!raw) throw new Error("TENANT_APP_PUBLIC_JWK is missing. Run `npm run keys` at the repo root.");
  return {
    audience: process.env.PORTAL_AUDIENCE ?? "landlord-portal",
    requesterName: process.env.PORTAL_REQUESTER_NAME ?? "Harbor View Apartments",
    tenantAppUrl: process.env.TENANT_APP_URL ?? "http://localhost:3001",
    tenantPublicJwk: JSON.parse(raw) as JWK,
    // Comma-separated approved build hashes. Empty = skip the check (dev only). Sam fills this in.
    trustedBuildHashes: (process.env.TRUSTED_BUILD_HASHES ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    // Public keys of banks whose deposit attestations we accept. When any are set, bank-backed
    // answers must carry a zero-knowledge proof over bank-signed deposits.
    trustedBankKeys: JSON.parse(process.env.TRUSTED_BANK_KEYS ?? "[]") as JWK[],
  };
}
