import { test } from "node:test";
import assert from "node:assert/strict";
import { commitDeposits, dayNumber, newSalt, payerId, proveIncome, requestTag, verifyIncomeProof, type ZkDeposit } from "../src/index";

const today = dayNumber("2026-10-17");
const paychecks = (payer: string, cents: number, n = 7): ZkDeposit[] =>
  Array.from({ length: n }, (_, i) => ({ amountCents: cents, day: today - 3 - i * 14, payer: payerId(payer) }));
const maya = paychecks("Acme Corp Payroll", 410000);
const leo = [...paychecks("Bean There Cafe Payroll", 230000), { amountCents: 600000, day: today - 1, payer: payerId("Transfer from savings") }];
const salt = newSalt();
const pub = async (deposits: ZkDeposit[], nonce = "nonce-1", s = salt) => ({ commitment: await commitDeposits(deposits, s), today, rentCents: 240000, multipleX100: 300, requestTag: requestTag(nonce) });

test("Maya proves YES and the landlord verifies it", { timeout: 300_000 }, async () => {
  const p = await pub(maya);
  const proof = await proveIncome(maya, salt, p);
  assert.equal(proof.result, true);
  assert.deepEqual(await verifyIncomeProof(proof, p), { valid: true, result: true });
});

test("the same deposits commit differently for every request (salt), so landlords can't link them", async () => {
  const a = await commitDeposits(maya, newSalt());
  const b = await commitDeposits(maya, newSalt());
  assert.notEqual(a, b);
});

test("Leo's one-time transfer doesn't count: the proof itself says NO", { timeout: 300_000 }, async () => {
  const p = await pub(leo);
  const proof = await proveIncome(leo, salt, p);
  assert.equal(proof.result, false);
  assert.deepEqual(await verifyIncomeProof(proof, p), { valid: true, result: false });
});

test("a proof can't be reused for another request, rent, date or deposit list", { timeout: 300_000 }, async () => {
  const p = await pub(maya);
  const proof = await proveIncome(maya, salt, p);
  assert.equal((await verifyIncomeProof(proof, { ...p, requestTag: requestTag("other") })).valid, false);
  assert.equal((await verifyIncomeProof(proof, { ...p, rentCents: 300000 })).valid, false);
  assert.equal((await verifyIncomeProof(proof, { ...p, today: today + 40 })).valid, false);
  assert.equal((await verifyIncomeProof(proof, { ...p, commitment: await commitDeposits(leo, salt) })).valid, false);
});

test("a flipped answer or a tampered proof is rejected", { timeout: 300_000 }, async () => {
  const p = await pub(leo);
  const proof = await proveIncome(leo, salt, p);
  const flipped = { ...proof, publicInputs: [...proof.publicInputs.slice(0, -1), "0x" + "0".repeat(63) + "1"] };
  assert.equal((await verifyIncomeProof(flipped, p)).valid, false);
  const bytes = Buffer.from(proof.proof, "base64"); bytes[40] ^= 1;
  assert.equal((await verifyIncomeProof({ ...proof, proof: bytes.toString("base64") }, p)).valid, false);
});

test("the commitment is the circuit's own hash: invented deposits can't match a signed one", { timeout: 300_000 }, async () => {
  const p = await pub(leo); // bank signed Leo's real deposits
  await assert.rejects(proveIncome(maya, salt, p)); // proving with richer deposits fails the commitment check
});

test("public inputs are cryptographically bound, not just compared by the wrapper", { timeout: 300_000 }, async () => {
  const expected = await pub(maya);
  const original = await proveIncome(maya, salt, expected);
  const changes = [
    { commitment: await commitDeposits(leo, salt) },
    { today: today + 1 },
    { rentCents: 250000 },
    { multipleX100: 400 },
    { requestTag: requestTag("another-request") },
  ];
  for (const [index, change] of changes.entries()) {
    const nextExpected = { ...expected, ...change };
    const changedValue = Object.values(change)[0];
    const replacement = typeof changedValue === "number"
      ? "0x" + BigInt(changedValue).toString(16).padStart(64, "0")
      : changedValue;
    const publicInputs = [...original.publicInputs];
    publicInputs[index] = replacement;
    // An attacker changes both the declared input and the expected request. Only the
    // proving backend, rather than the wrapper's equality checks, can reject this.
    const verdict = await verifyIncomeProof({ ...original, publicInputs }, nextExpected);
    assert.equal(verdict.valid, false, `changed ${Object.keys(change)[0]} must invalidate the proof`);
  }
});
