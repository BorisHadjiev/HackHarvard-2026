import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeJwt } from "jose";
import { pairwiseSubject, signClaim, generateSigningKeys, AGE_EVIDENCE, type VerificationRequest } from "@ntk/shared";
import { buildClaimPayload, buildAgeClaimPayload } from "../lib/claim";

const request: VerificationRequest = {
  id: "request-a", audience: "landlord-a", nonce: "nonce-a", requesterName: "Landlord A",
  question: { type: "income_to_rent", rent: 2400, multiple: 3 },
  createdAt: "2026-10-17T12:00:00Z", expiresAt: "2026-10-18T12:00:00Z", status: "pending",
};
const tenant = { id: "maya", secret: "test-only-secret" };
const income = { meets: true, medianMonthlyIncome: 8200, recurringPayers: ["private payroll"] };
const integrity = { passed: true, hash: "shared-build" };

test("builder preserves the real route's entire payload and subject derivation", async () => {
  const payload = await buildClaimPayload(request, tenant, income, integrity);
  assert.deepEqual(payload, {
    aud: "landlord-a", nonce: "nonce-a", sub: await pairwiseSubject("test-only-secret:maya", "landlord-a"),
    claim: { type: "income_to_rent", rent: 2400, multiple: 3, result: true },
    evidence: { source: "bank", strength: "bank", window_days: 90, method: "recurring deposits, median month" },
    build: { hash: "shared-build", integrity: "passed" },
  });
  assert.ok(!JSON.stringify(payload).includes("8200"));
  assert.ok(!JSON.stringify(payload).includes("private payroll"));
  assert.deepEqual(await buildClaimPayload(request, tenant, income, integrity), payload);
});

test("builder changes subject per audience and tenant while retaining negative answers", async () => {
  const a = await buildClaimPayload(request, tenant, income, integrity);
  const b = await buildClaimPayload({ ...request, audience: "landlord-b", nonce: "nonce-b" }, tenant, income, integrity);
  const other = await buildClaimPayload(request, { ...tenant, secret: "other-secret" }, income, integrity);
  assert.notEqual(a.sub, b.sub);
  assert.notEqual(a.sub, other.sub);
  assert.equal(b.nonce, "nonce-b");
  assert.equal((await buildClaimPayload(request, tenant, { ...income, meets: false }, integrity)).claim.result, false);
});

test("builder carries document evidence through unchanged and still holds no dollar amounts", async () => {
  const evidence = { source: "document" as const, strength: "document_bank_matched" as const, window_days: 365, method: "income documents, annualized gross income" };
  const payload = await buildClaimPayload(request, tenant, { ...income, medianMonthlyIncome: 12168.95 }, integrity, evidence);
  assert.deepEqual(payload.evidence, evidence);
  assert.ok(!JSON.stringify(payload).includes("12168"));
});

const ageRequest: VerificationRequest = { ...request, id: "request-age", nonce: "nonce-age", question: { type: "age_over", min_age: 18 } };

test("age builder: same subject derivation, fixed evidence, only a yes/no", async () => {
  const yes = await buildAgeClaimPayload(ageRequest, tenant, true, integrity);
  assert.deepEqual(yes, {
    aud: "landlord-a", nonce: "nonce-age", sub: await pairwiseSubject("test-only-secret:maya", "landlord-a"),
    claim: { type: "age_over", min_age: 18, result: true },
    evidence: AGE_EVIDENCE,
    build: { hash: "shared-build", integrity: "passed" },
  });
  assert.equal(yes.sub, (await buildClaimPayload(request, tenant, income, integrity)).sub, "same tenant, same landlord -> same pairwise id across question types");
  assert.equal((await buildAgeClaimPayload(ageRequest, tenant, false, integrity)).claim.result, false);
  await assert.rejects(buildAgeClaimPayload(request, tenant, true, integrity), /answers age questions/);
  await assert.rejects(buildClaimPayload(ageRequest, tenant, income, integrity), /answers income questions/);
});

test("a signed age claim, decoded, has exactly the allowed fields and no date, age or name", async () => {
  const { privateJwk } = await generateSigningKeys();
  const payload = await buildAgeClaimPayload(ageRequest, tenant, true, integrity);
  const decoded = decodeJwt(await signClaim(payload, privateJwk)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(decoded).sort(), ["aud", "build", "claim", "evidence", "exp", "iat", "iss", "nonce", "sub"]);
  assert.deepEqual(Object.keys(decoded.claim as object).sort(), ["min_age", "result", "type"]);
  assert.deepEqual(decoded.evidence, AGE_EVIDENCE);
  const text = JSON.stringify({ ...decoded, evidence: undefined });
  assert.ok(!/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/.test(text), "no dates anywhere");
  assert.ok(!/birth|dob|"age"|years|name|maya|license|passport|issuer|expir/i.test(text), "no birth, age, name or document words");
});
