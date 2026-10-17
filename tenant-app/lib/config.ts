import type { JWK } from "@ntk/shared";

// Values come from tenant-app/.env.local, written by `npm run keys`.
export function tenantConfig() {
  const raw = process.env.TENANT_APP_PRIVATE_JWK;
  if (!raw) throw new Error("TENANT_APP_PRIVATE_JWK is missing. Run `npm run keys` at the repo root.");
  return {
    privateJwk: JSON.parse(raw) as JWK,
    // Secret used to derive a different tenant ID for every landlord.
    tenantSecret: process.env.TENANT_SECRET ?? "dev-tenant-secret",
    defaultPortalUrl: process.env.DEFAULT_PORTAL_URL ?? "http://localhost:3000",
    // The stand-in bank that signs deposit commitments for zero-knowledge proofs. Empty = proofs off.
    bankSignerUrl: process.env.BANK_SIGNER_URL ?? "http://localhost:3002",
    nessie: {
      apiKey: process.env.NESSIE_API_KEY ?? "",
      baseUrl: process.env.NESSIE_BASE_URL ?? "http://api.nessieisreal.com",
      // Demo tenants map to Nessie account ids once Angelo seeds them.
      accounts: {
        maya: process.env.NESSIE_ACCOUNT_MAYA ?? "",
        leo: process.env.NESSIE_ACCOUNT_LEO ?? "",
      } as Record<string, string>,
    },
  };
}
