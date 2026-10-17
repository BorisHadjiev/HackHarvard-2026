// Bank data. Owner: Angelo.
// Runs inside the tenant app only: raw deposits never leave the tenant's machine.
import { tenantConfig } from "./config";

export interface Deposit {
  id: string;
  /** Who paid (employer name or payer id) */
  payer: string;
  amount: number; // dollars
  date: string; // YYYY-MM-DD
}

export const DEMO_TENANTS = {
  maya: "Maya (demo, earns enough)",
  leo: "Leo (demo, short, with a one-time transfer)",
} as const;
export type DemoTenant = keyof typeof DEMO_TENANTS;

/**
 * Fetch ~90 days of deposits for a demo tenant.
 * If Nessie is configured (NESSIE_API_KEY + NESSIE_ACCOUNT_<NAME>), uses live Nessie data;
 * otherwise falls back to fixtures so everyone can develop before the key exists.
 *
 * TODO(Angelo): confirm the field names below against the Nessie docs
 * (GET /accounts/{id}/deposits?key=...), then seed both demo accounts (scripts/seed-nessie.ts).
 */
export async function fetchDeposits(tenant: DemoTenant, now = new Date()): Promise<{ deposits: Deposit[]; source: "nessie" | "fixture" }> {
  const { nessie } = tenantConfig();
  const accountId = nessie.accounts[tenant];
  if (!nessie.apiKey || !accountId) return { deposits: fixtureDeposits(tenant, now), source: "fixture" };

  const res = await fetch(`${nessie.baseUrl}/accounts/${accountId}/deposits?key=${nessie.apiKey}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Nessie returned ${res.status}`);
  const raw = (await res.json()) as Array<{ _id: string; payee_id?: string; description?: string; amount: number; transaction_date: string }>;
  return {
    source: "nessie",
    deposits: raw.map((d) => ({ id: d._id, payer: d.description || d.payee_id || "unknown", amount: d.amount, date: d.transaction_date })),
  };
}

/** Deterministic fixtures relative to `now`: paychecks every 14 days for 90 days. */
export function fixtureDeposits(tenant: DemoTenant, now = new Date()): Deposit[] {
  const day = (offset: number) => new Date(now.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
  const paychecks = (payer: string, amount: number) =>
    Array.from({ length: 7 }, (_, i) => ({ id: `${tenant}-pay-${i}`, payer, amount, date: day(3 + i * 14) }));

  if (tenant === "maya") return paychecks("Acme Corp Payroll", 4100); // ~$8,900/month, passes 3x $2,400
  // Leo earns ~$5,000/month but moved in a one-time $6,000 the day before applying.
  return [...paychecks("Bean There Cafe Payroll", 2300), { id: "leo-transfer", payer: "Transfer from savings", amount: 6000, date: day(1) }];
}
