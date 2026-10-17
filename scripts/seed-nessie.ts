// Seeds the two demo tenants in Capital One's Nessie sandbox. Owner: Angelo.
// Usage: NESSIE_API_KEY=... npx tsx scripts/seed-nessie.ts
// Then copy the printed NESSIE_ACCOUNT_MAYA / NESSIE_ACCOUNT_LEO lines into tenant-app/.env.local.
//
// DRAFT: endpoint paths and body fields follow the Nessie docs as we understand them.
// TODO(Angelo): check each call against http://api.nessieisreal.com/documentation before relying on it.
import { fixtureDeposits, type DemoTenant } from "../tenant-app/lib/nessie";

const KEY = process.env.NESSIE_API_KEY;
const BASE = process.env.NESSIE_BASE_URL ?? "http://api.nessieisreal.com";
if (!KEY) throw new Error("Set NESSIE_API_KEY first");

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}?key=${KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
  const account = await post(`/customers/${customer._id}/accounts`, { type: "Checking", nickname: `${tenant} checking`, rewards: 0, balance: 0 });
  for (const d of fixtureDeposits(tenant)) {
    await post(`/accounts/${account._id}/deposits`, { medium: "balance", transaction_date: d.date, status: "completed", amount: d.amount, description: d.payer });
  }
  console.log(`NESSIE_ACCOUNT_${tenant.toUpperCase()}=${account._id}`);
}
