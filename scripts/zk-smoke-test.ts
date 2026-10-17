// Real end-to-end ZK checks against the local portal and separate demo bank signer.
// Uses the same proof builder as the tenant app. Never prints keys, deposits or proof payloads.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { decodeJwt } from "jose";
import { generateSigningKeys, signClaim, type VerificationRequest } from "@ntk/shared";
import { signAttestation } from "@ntk/bank-signer";
import { METHOD, WINDOW_DAYS } from "@ntk/zk";
import { tenantConfig } from "../tenant-app/lib/config";
import { buildClaimPayload } from "../tenant-app/lib/claim";
import { checkIntegrity } from "../tenant-app/lib/integrity";
import { proveWithBank, type ZkEvidence } from "../tenant-app/lib/zk-prove";

const env = new URL("../tenant-app/.env.local", import.meta.url);
if (existsSync(env)) loadEnvFile(env);
const config = tenantConfig();
const portal = process.env.PORTAL ?? "http://localhost:3000";
const bank = process.env.BANK_SIGNER_URL ?? config.bankSignerUrl;
if (!bank) throw new Error("A separate demo bank signer must be configured for smoke:zk");
const integrity = await checkIntegrity();
assert.equal(integrity.passed, true, "the tenant build must pass its existing integrity policy");
const evidence = { source: "bank", strength: "bank", window_days: WINDOW_DAYS, method: METHOD } as const;

async function post(path: string, body: unknown) {
  const response = await fetch(`${portal}${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
function pass(label: string) { console.log(`PASS  ${label}`); }
async function create() {
  const response = await post("/api/requests", { rent: 2400, multiple: 3 });
  assert.equal(response.status, 201, "create a local test request");
  return response.body.request as VerificationRequest;
}
async function token(request: VerificationRequest, tenant: string, answer: boolean) {
  const payload = await buildClaimPayload(request, { id: tenant, secret: config.tenantSecret },
    { meets: answer, medianMonthlyIncome: 0, recurringPayers: [] }, integrity, evidence);
  return signClaim(payload, config.privateJwk);
}
async function submit(request: VerificationRequest, tenant: string, answer: boolean, zk?: ZkEvidence) {
  return post("/api/claims", { requestId: request.id, token: await token(request, tenant, answer), zk });
}

const request = await create();
const maya = await proveWithBank(bank, "maya", request);
assert.equal(maya.result, true);

const missing = await submit(request, "maya", true);
assert.equal(missing.body.code, "proof_required", "portal must enforce the bank proof, not just the signed yes");
pass("a signed bank claim without a proof is rejected");

const changedBytes = Buffer.from(maya.zk.proof, "base64");
changedBytes[40] ^= 1;
const altered = await submit(request, "maya", true, { ...maya.zk, proof: changedBytes.toString("base64") });
assert.equal(altered.body.code, "bad_proof");
pass("a corrupted proof is rejected");

const att = decodeJwt(maya.zk.attestation);
const impostor = await generateSigningKeys();
const fakeAttestation = await signAttestation({ commitment: String(att.commitment), asOfDay: Number(att.asOfDay), circuit: String(att.circuit) }, impostor.privateJwk);
const fake = await submit(request, "maya", true, { ...maya.zk, attestation: fakeAttestation });
assert.equal(fake.body.code, "bad_bank_attestation");
pass("an attestation signed by an untrusted key is rejected");

const other = await create();
const moved = await submit(other, "maya", true, maya.zk);
assert.equal(moved.body.code, "bad_proof");
pass("a proof cannot be moved to a different request");

const mismatch = await submit(request, "maya", false, maya.zk);
assert.equal(mismatch.body.code, "proof_mismatch");
pass("the signed answer must agree with the proof");

const accepted = await submit(request, "maya", true, maya.zk);
assert.equal(accepted.status, 200);
assert.equal(accepted.body.answer, true);
assert.equal(accepted.body.proof, "zk");
pass("a real bank-signed ZK proof is accepted as YES");

const replay = await submit(request, "maya", true, maya.zk);
assert.equal(replay.status, 409);
assert.equal(replay.body.code, "replayed");
pass("the accepted proof cannot be replayed");

const noRequest = await create();
const leo = await proveWithBank(bank, "leo", noRequest);
assert.equal(leo.result, false);
const no = await submit(noRequest, "leo", false, leo.zk);
assert.equal(no.status, 200);
assert.equal(no.body.answer, false);
assert.equal(no.body.proof, "zk");
pass("the proof excludes Leo's one-off transfer and returns NO");

const publicResponse = await fetch(`${portal}/api/requests/${request.id}`);
const publicRecord = await publicResponse.json();
assert.deepEqual(Object.keys(publicRecord.result).sort(), ["answer", "evidence", "proof", "verifiedAt"]);
assert.equal(publicRecord.result.proof, "zk");
pass("the public result contains only verdict and verification metadata");
