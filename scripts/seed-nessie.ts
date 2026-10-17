// Seeds the two demo tenants in Capital One's Nessie sandbox. Owner: Angelo.
// Usage: npx tsx scripts/seed-nessie.ts
// Reads NESSIE_API_KEY and NESSIE_BASE_URL from tenant-app/.env.local (shell values win).
// Then copy the printed NESSIE_ACCOUNT_MAYA / NESSIE_ACCOUNT_LEO lines into tenant-app/.env.local.
//
// Endpoint paths and body fields: https://prod.nessieisreal.com/docs.
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { fixtureDeposits, type DemoTenant } from "../tenant-app/lib/nessie";

const envPath = fileURLToPath(new URL("../tenant-app/.env.local", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

const KEY = process.env.NESSIE_API_KEY;
const BASE = (process.env.NESSIE_BASE_URL ?? "http://api.nessieisreal.com").replace(/\/+$/, "");
if (!KEY) throw new Error("Set NESSIE_API_KEY in tenant-app/.env.local first");
if (BASE === "BASE_URL_HERE") throw new Error("Replace BASE_URL_HERE with the Nessie API base URL in tenant-app/.env.local");

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}?${new URLSearchParams({ key: KEY! })}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json.objectCreated ?? json;
}

const people: Record<DemoTenant, { first: string; last: string }> = { maya: { first: "Maya", last: "Demo" }, leo: { first: "Leo", last: "Demo" } };

for (const tenant of Object.keys(people) as DemoTenant[]) {
  const customer = await post("/customers", {
    first_name: people[tenant].first,
    last_name: people[tenant].last,
    address: { street_number: "1", street_name: "Oxford St", city: "Cambridge", state: "MA", zip: "02138" },
  });
  if (typeof customer?._id !== "string" || !customer._id) throw new Error("Nessie customer creation returned no _id; cannot seed accounts");
  const account = await post(`/customers/${encodeURIComponent(customer._id)}/accounts`, { type: "Checking", nickname: `${tenant} checking`, rewards: 0, balance: 0 });
  if (typeof account?._id !== "string" || !account._id) throw new Error("Nessie account creation returned no _id; cannot seed deposits");
  for (const d of fixtureDeposits(tenant)) {
    await post(`/accounts/${encodeURIComponent(account._id)}/deposits`, { medium: "balance", transaction_date: d.date, status: "completed", amount: d.amount, description: d.payer });
  }
  console.log(`NESSIE_ACCOUNT_${tenant.toUpperCase()}=${account._id}`);
}
