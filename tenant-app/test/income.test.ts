import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateIncome } from "../lib/income";
import { fixtureDeposits } from "../lib/nessie";

const now = new Date("2026-10-17T12:00:00Z");

test("Maya earns enough for 3x $2,400", () => {
  const r = evaluateIncome(fixtureDeposits("maya", now), 2400, 3, now);
  assert.equal(r.meets, true);
  assert.deepEqual(r.recurringPayers, ["Acme Corp Payroll"]);
});

test("Leo's one-time transfer does not count, so he falls short", () => {
  const deposits = fixtureDeposits("leo", now);
  const r = evaluateIncome(deposits, 2400, 3, now);
  assert.equal(r.meets, false);
  assert.ok(!r.recurringPayers.includes("Transfer from savings"));

  // Sanity check: a naive 3-month average WOULD have passed him. That's the cheat we block.
  const total = deposits.reduce((s, d) => s + d.amount, 0);
  assert.ok(total / 3 >= 3 * 2400);
});

test("deposits older than 90 days are ignored", () => {
  const old = [1, 2, 3].map((i) => ({ id: `o${i}`, payer: "Old Job", amount: 10_000, date: "2026-01-0" + i }));
  assert.equal(evaluateIncome(old, 2400, 3, now).meets, false);
});
