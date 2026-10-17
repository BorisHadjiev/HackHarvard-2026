import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createLinkToken, exchangePublicToken, fetchPlaidDeposits, PlaidError, _resetPlaidLinks } from "../lib/plaid";

type Call = { url: string; body: Record<string, unknown> };

function fakePlaid(handlers: Record<string, (body: Record<string, unknown>, n: number) => [number, unknown]>) {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  const impl = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url, body });
    counts[path] = (counts[path] ?? 0) + 1;
    const [status, json] = handlers[path](body, counts[path]);
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

beforeEach(() => {
  process.env.PLAID_CLIENT_ID = "test-client";
  process.env.PLAID_SECRET = "test-secret";
  delete process.env.PLAID_ENV;
  _resetPlaidLinks();
});

test("link token request uses the sandbox, transactions, and a random user id", async () => {
  const p = fakePlaid({ "/link/token/create": () => [200, { link_token: "link-sandbox-123" }] });
  assert.equal(await createLinkToken(p.impl), "link-sandbox-123");
  assert.equal(p.calls[0].url, "https://sandbox.plaid.com/link/token/create");
  assert.deepEqual(p.calls[0].body.products, ["transactions"]);
  assert.equal(p.calls[0].body.client_id, "test-client");
  assert.match(String((p.calls[0].body.user as { client_user_id: string }).client_user_id), /^[0-9a-f-]{36}$/);
});

test("deposits are the incoming (negative) transactions, paged, after waiting for Plaid to be ready", async () => {
  const p = fakePlaid({
    "/item/public_token/exchange": () => [200, { access_token: "access-sandbox-abc" }],
    "/transactions/get": (body, n) => {
      if (n === 1) return [400, { error_code: "PRODUCT_NOT_READY", error_message: "not ready" }];
      const offset = (body.options as { offset: number }).offset;
      const page = offset === 0
        ? [{ transaction_id: "t1", amount: -4100, date: "2026-10-14", name: "ACME PAYROLL", merchant_name: null }, { transaction_id: "t2", amount: 52.1, date: "2026-10-13", name: "Grocery" }]
        : [{ transaction_id: "t3", amount: -4100, date: "2026-09-30", name: "ACME PAYROLL" }, { transaction_id: "t4", amount: -20, date: "2026-10-15", name: "Refund", pending: true }];
      return [200, { transactions: page, total_transactions: 4 }];
    },
  });
  const linkId = await exchangePublicToken("public-sandbox-xyz", "First Platypus Bank", p.impl);
  const deposits = await fetchPlaidDeposits(linkId, new Date("2026-10-17T12:00:00Z"), p.impl, 1);
  assert.deepEqual(deposits, [
    { id: "t1", payer: "ACME PAYROLL", amount: 4100, date: "2026-10-14" },
    { id: "t3", payer: "ACME PAYROLL", amount: 4100, date: "2026-09-30" },
  ]);
  const get = p.calls.filter((c) => c.url.endsWith("/transactions/get"));
  assert.equal(get[1].body.access_token, "access-sandbox-abc");
  assert.equal(get[1].body.start_date, "2026-07-19");
});

test("without keys or with an unknown link the app says so instead of guessing", async () => {
  delete process.env.PLAID_CLIENT_ID;
  await assert.rejects(createLinkToken(), (e: unknown) => e instanceof PlaidError && e.code === "NOT_CONFIGURED");
  process.env.PLAID_CLIENT_ID = "test-client";
  await assert.rejects(fetchPlaidDeposits("not-a-link"), (e: unknown) => e instanceof PlaidError && e.code === "LINK_EXPIRED");
});
