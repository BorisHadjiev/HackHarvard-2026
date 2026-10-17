import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK } from "jose";
import { signAttestation, verifyAttestation, BANK_TTL_SECONDS } from "../src/attest";
import { toZkDeposits } from "../src/server-pure";

async function keys() {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  return { priv: await exportJWK(privateKey), pub: await exportJWK(publicKey) };
}
const payload = { commitment: "0x" + "ab".repeat(32), asOfDay: 20743, circuit: "sha256:abc" };

test("an attestation verifies with the bank's key and not with another", async () => {
  const bank = await keys();
  const other = await keys();
  const jws = await signAttestation(payload, bank.priv);
  assert.deepEqual(await verifyAttestation(jws, [other.pub, bank.pub]), payload);
  await assert.rejects(verifyAttestation(jws, [other.pub]));
});

test("attestations expire and carry a day-rounded issue time", async () => {
  const bank = await keys();
  const signed = new Date("2026-10-17T15:42:00Z");
  const jws = await signAttestation(payload, bank.priv, signed);
  const [, body] = jws.split(".");
  const { iat, exp } = JSON.parse(Buffer.from(body, "base64url").toString());
  assert.equal(iat, Date.parse("2026-10-17T00:00:00Z") / 1000);
  assert.equal(exp - iat, 86400 + BANK_TTL_SECONDS);
  await assert.rejects(verifyAttestation(jws, [bank.pub], new Date(exp * 1000 + 1000)));
});

test("deposits become opaque ids and day numbers, newest first", () => {
  const zk = toZkDeposits([
    { payer: "Acme Corp Payroll", amount: 4100, date: "2026-09-30" },
    { payer: "ACME CORP PAYROLL", amount: 4100.5, date: "2026-10-14" },
  ]);
  assert.equal(zk[0].day > zk[1].day, true);
  assert.equal(zk[0].amountCents, 410050);
  assert.equal(zk[0].payer, zk[1].payer, "same employer, different casing -> same id");
  assert.ok(zk.every((d) => typeof d.payer === "bigint"), "payer names are replaced by opaque ids");
});
