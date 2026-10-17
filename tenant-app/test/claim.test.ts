import { test } from "node:test";
import assert from "node:assert/strict";
import { pairwiseSubject, type VerificationRequest } from "@ntk/shared";
import { buildClaimPayload } from "../lib/claim";

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
    evidence: { source: "bank", window_days: 90, method: "recurring deposits, median month" },
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
