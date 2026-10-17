import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSigningKeys, type VerificationRequest } from "@ntk/shared";
import { commitDeposits, circuitId, dayNumber, newSalt, proveIncome, requestTag } from "@ntk/zk";
import { signAttestation } from "@ntk/bank-signer";
import { toZkDeposits } from "../../bank-signer/src/server-pure";
import { fixtureDeposits } from "../../tenant-app/lib/nessie";
import { checkProof, looksLikeProof } from "../lib/proof";

const now = new Date("2026-10-17T15:00:00Z");
const today = dayNumber(now.toISOString());
const request: VerificationRequest = {
  id: "r1", nonce: "one-time-code", requesterName: "Harbor View", audience: "landlord-portal",
  question: { type: "income_to_rent", rent: 2400, multiple: 3 },
  createdAt: "2026-10-17T14:00:00Z", expiresAt: "2026-10-24T14:00:00Z", status: "pending",
};
const pubFor = (commitment: string) => ({ commitment, today, rentCents: 240000, multipleX100: 300, requestTag: requestTag(request.nonce) });

async function proven(tenant: "maya" | "leo", bankPriv: Parameters<typeof signAttestation>[1], nonce = request.nonce) {
  const deposits = toZkDeposits(fixtureDeposits(tenant, now));
  const salt = newSalt();
  const commitment = await commitDeposits(deposits, salt);
  const attestation = await signAttestation({ commitment, asOfDay: today, circuit: circuitId() }, bankPriv, now);
  const proof = await proveIncome(deposits, salt, { ...pubFor(commitment), requestTag: requestTag(nonce) });
  return { zk: { proof: proof.proof, publicInputs: proof.publicInputs, attestation }, result: proof.result };
}

test("a bank-signed, request-bound proof passes; the answer comes from the proof", { timeout: 300_000 }, async () => {
  const bank = await generateSigningKeys();
  const maya = await proven("maya", bank.privateJwk);
  assert.deepEqual(await checkProof(maya.zk, request, [bank.publicJwk], now), { ok: true, result: true });
  const leo = await proven("leo", bank.privateJwk);
  assert.deepEqual(await checkProof(leo.zk, request, [bank.publicJwk], now), { ok: true, result: false });
  assert.ok(looksLikeProof(maya.zk));
  assert.ok(!looksLikeProof({ proof: "x" }));
});

test("an attestation from a key the portal doesn't trust is rejected", { timeout: 300_000 }, async () => {
  const bank = await generateSigningKeys();
  const impostor = await generateSigningKeys(); // e.g. the tenant signing their own invented deposits
  const fake = await proven("maya", impostor.privateJwk);
  const check = await checkProof(fake.zk, request, [bank.publicJwk], now);
  assert.equal(check.ok, false);
  assert.equal(!check.ok && check.code, "bad_bank_attestation");
});

test("a proof made for another request can't be replayed here", { timeout: 300_000 }, async () => {
  const bank = await generateSigningKeys();
  const other = await proven("maya", bank.privateJwk, "a-different-request");
  const check = await checkProof(other.zk, request, [bank.publicJwk], now);
  assert.equal(check.ok, false);
  assert.equal(!check.ok && check.code, "bad_proof");
});

test("a flipped public result or a stale attestation is rejected", { timeout: 300_000 }, async () => {
  const bank = await generateSigningKeys();
  const leo = await proven("leo", bank.privateJwk);
  const flipped = { ...leo.zk, publicInputs: [...leo.zk.publicInputs.slice(0, -1), "0x" + "0".repeat(63) + "1"] };
  const c1 = await checkProof(flipped, request, [bank.publicJwk], now);
  assert.equal(!c1.ok && c1.code, "bad_proof");
  const futureRequest = { ...request, createdAt: "2026-10-25T00:00:00Z" }; // attestation predates the request by a week
  const c2 = await checkProof(leo.zk, futureRequest, [bank.publicJwk], now);
  assert.equal(!c2.ok && c2.code, "stale_attestation");
});
