import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { fetchDeposits, fixtureDeposits } from "../lib/nessie";

function withEnv(t: TestContext, values: NodeJS.ProcessEnv) {
  const original = process.env;
  process.env = values;
  t.after(() => { process.env = original; });
}

test("Nessie uses the account deposit endpoint and documented response fields", async (t) => {
  withEnv(t, {
    ...process.env,
    TENANT_APP_PRIVATE_JWK: "{}",
    NESSIE_API_KEY: "key&with=special+characters",
    NESSIE_BASE_URL: "https://nessie.example/api/",
    NESSIE_ACCOUNT_MAYA: "account/id",
  });
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://nessie.example");
    assert.equal(url.pathname, "/api/accounts/account%2Fid/deposits");
    assert.deepEqual([...url.searchParams], [["key", process.env.NESSIE_API_KEY]]);
    assert.equal(init.cache, "no-store");
    return Response.json([
      { _id: "deposit-1", medium: "balance", status: "completed", description: "Acme Payroll", amount: 4100, transaction_date: "2026-10-14" },
      { _id: "deposit-2", description: "", payee_id: "recipient-account", amount: 100, transaction_date: "2026-10-15" },
    ]);
  });
  assert.deepEqual(await fetchDeposits("maya"), {
    source: "nessie",
    deposits: [
      { id: "deposit-1", payer: "Acme Payroll", amount: 4100, date: "2026-10-14" },
      { id: "deposit-2", payer: "unknown", amount: 100, date: "2026-10-15" },
    ],
  });
});

test("unconfigured Nessie still uses fixtures without making requests", async (t) => {
  withEnv(t, { ...process.env, TENANT_APP_PRIVATE_JWK: "{}", NESSIE_API_KEY: "" });
  t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected request"); });
  const now = new Date("2026-10-17T12:00:00Z");
  assert.deepEqual(await fetchDeposits("leo", now), { source: "fixture", deposits: fixtureDeposits("leo", now) });
});

test("Nessie failures propagate rather than falling back to fixtures", async (t) => {
  withEnv(t, {
    ...process.env, TENANT_APP_PRIVATE_JWK: "{}", NESSIE_API_KEY: "test-key",
    NESSIE_BASE_URL: "https://nessie.example", NESSIE_ACCOUNT_MAYA: "account-1",
  });
  t.mock.method(globalThis, "fetch", async () => new Response("Unauthorized", { status: 401 }));
  await assert.rejects(fetchDeposits("maya"), /Nessie returned 401/);
});
