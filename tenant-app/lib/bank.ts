// Which bank data the tenant chose: a demo account (Nessie or fixture) or a Plaid-linked bank.
import { fetchDeposits, DEMO_TENANTS, type DemoTenant, type Deposit } from "./nessie";
import { fetchPlaidDeposits } from "./plaid";

export interface BankChoice {
  /** Demo identity; also used for the pairwise subject. */
  tenant: DemoTenant;
  /** Set when the tenant connected a bank through Plaid. */
  plaidLinkId?: string;
}

export function parseBankChoice(tenant: unknown, plaidLinkId: unknown): BankChoice {
  return {
    tenant: (typeof tenant === "string" && tenant in DEMO_TENANTS ? tenant : "maya") as DemoTenant,
    plaidLinkId: typeof plaidLinkId === "string" && plaidLinkId ? plaidLinkId : undefined,
  };
}

export async function getBankDeposits(choice: BankChoice, now = new Date()): Promise<{ deposits: Deposit[]; source: "nessie" | "fixture" | "plaid" }> {
  if (choice.plaidLinkId) return { deposits: await fetchPlaidDeposits(choice.plaidLinkId, now), source: "plaid" };
  return fetchDeposits(choice.tenant, now);
}
