import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

function runSeed(mode = "wrapped", envText = 'NESSIE_API_KEY="local&key=+value"\nNESSIE_BASE_URL="https://nessie.example/api/"\n', overrides: Partial<NodeJS.ProcessEnv> = {}) {
  const root = mkdtempSync(join(tmpdir(), "ntk-seed-test-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "tenant-app/lib"), { recursive: true });
    // A temporary project verifies env resolution without reading or replacing real secrets.
    for (const path of ["scripts/seed-nessie.ts", "tenant-app/lib/nessie.ts", "tenant-app/lib/config.ts"]) {
      copyFileSync(new URL(`../../${path}`, import.meta.url), join(root, path));
    }
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    writeFileSync(join(root, "tenant-app/.env.local"), envText);
    const logPath = join(root, "requests.jsonl");
    const mockPath = join(root, "mock.mjs");
    writeFileSync(mockPath, `
      import { appendFileSync } from "node:fs";
      let n = 0;
      globalThis.fetch = async (url, init) => {
        appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ url, ...init, body: JSON.parse(init.body) }) + "\\n");
        if (${JSON.stringify(mode)} === "error") return Response.json({ message: "invalid request" }, { status: 400 });
        if (${JSON.stringify(mode)} === "missing-id") return Response.json("Customer created", { status: 201 });
        const object = { _id: "id-" + (++n) };
        if (${JSON.stringify(mode)} === "missing-account-id" && n === 2) return Response.json("Account created", { status: 201 });
        return Response.json(${JSON.stringify(mode)} === "direct" ? object : { objectCreated: object }, { status: 201 });
      };
    `);
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("NESSIE_") || key === "NODE_ENV") delete env[key];
    Object.assign(env, overrides);
    const result = spawnSync(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), "--import", mockPath, join(root, "scripts/seed-nessie.ts")], {
      cwd: tmpdir(), env, encoding: "utf8",
    });
    let requests: Array<{ url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    try { requests = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return { ...result, requests };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const mode of ["wrapped", "direct"]) {
  test(`seeder reads tenant-app/.env.local and uses documented paths and bodies (${mode})`, () => {
    const result = runSeed(mode);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.requests.length, 19); // Two customers, two accounts, fifteen deposits.
    for (const request of result.requests) {
      const url = new URL(request.url);
      assert.equal(url.origin, "https://nessie.example");
      assert.deepEqual([...url.searchParams], [["key", "local&key=+value"]]);
      assert.equal(request.method, "POST");
      assert.equal(request.headers["content-type"], "application/json");
    }
    const [customer, account, deposit] = result.requests;
    assert.equal(new URL(customer.url).pathname, "/api/customers");
    assert.deepEqual(customer.body, {
      first_name: "Maya", last_name: "Demo",
      address: { street_number: "1", street_name: "Oxford St", city: "Cambridge", state: "MA", zip: "02138" },
    });
    assert.equal(new URL(account.url).pathname, "/api/customers/id-1/accounts");
    assert.deepEqual(account.body, { type: "Checking", nickname: "maya checking", rewards: 0, balance: 0 });
    for (const request of result.requests.filter((r) => new URL(r.url).pathname.endsWith("/deposits"))) {
      assert.match(new URL(request.url).pathname, /^\/api\/accounts\/id-(2|11)\/deposits$/);
      assert.deepEqual(Object.keys(request.body).sort(), ["amount", "description", "medium", "status", "transaction_date"]);
      assert.equal(request.body.medium, "balance");
      assert.equal(request.body.status, "completed");
      assert.match(String(request.body.transaction_date), /^\d{4}-\d{2}-\d{2}$/);
    }
    assert.equal(deposit.body.description, "Acme Corp Payroll");
    assert.equal(deposit.body.amount, 4100);
    assert.match(result.stdout, /NESSIE_ACCOUNT_MAYA=id-2/);
    assert.match(result.stdout, /NESSIE_ACCOUNT_LEO=id-11/);
    assert.ok(!result.stdout.includes("local&key"));
  });
}

test("seeder stops on API failure before creating dependent objects", () => {
  const result = runSeed("error");
  assert.notEqual(result.status, 0);
  assert.equal(result.requests.length, 1);
  assert.match(result.stderr, /\/customers -> 400/);
});

test("seeder refuses missing IDs rather than requesting /undefined/accounts", () => {
  const result = runSeed("missing-id");
  assert.notEqual(result.status, 0);
  assert.equal(result.requests.length, 1);
  assert.match(result.stderr, /customer creation returned no _id/);
});

test("seeder reports a missing API key before making requests", () => {
  const result = runSeed("wrapped", "NESSIE_BASE_URL=https://nessie.example\n");
  assert.notEqual(result.status, 0);
  assert.equal(result.requests.length, 0);
  assert.match(result.stderr, /Set NESSIE_API_KEY in tenant-app\/\.env.local/);
});

test("seeder preserves shell overrides for both Nessie settings", () => {
  const result = runSeed("wrapped", undefined, { NESSIE_API_KEY: "shell-key", NESSIE_BASE_URL: "https://override.example/" });
  assert.equal(result.status, 0, result.stderr);
  const url = new URL(result.requests[0].url);
  assert.equal(url.origin, "https://override.example");
  assert.equal(url.searchParams.get("key"), "shell-key");
});

test("seeder rejects the unfilled base URL placeholder before making requests", () => {
  const result = runSeed("wrapped", "NESSIE_API_KEY=test-key\nNESSIE_BASE_URL=BASE_URL_HERE\n");
  assert.notEqual(result.status, 0);
  assert.equal(result.requests.length, 0);
  assert.match(result.stderr, /Replace BASE_URL_HERE/);
});

test("seeder stops before depositing when account creation returns no ID", () => {
  const result = runSeed("missing-account-id");
  assert.notEqual(result.status, 0);
  assert.equal(result.requests.length, 2);
  assert.match(result.stderr, /account creation returned no _id/);
});
