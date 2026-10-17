import { test } from "node:test";
import assert from "node:assert/strict";
import type { VerificationRequest } from "@ntk/shared";
import { buildClaimPayload } from "../lib/claim";
import { declineNotice, deliveryFromScan } from "../lib/document-outcome";
import { decide } from "../lib/documents/analyze";
import type { DocumentReport } from "../lib/documents/types";

const request: VerificationRequest = {
  id: "request-a",
  audience: "landlord-a",
  nonce: "nonce-a",
  requesterName: "Harbor View Apartments",
  question: { type: "income_to_rent", rent: 2400, multiple: 3 },
  createdAt: "2026-10-17T12:00:00Z",
  expiresAt: "2026-10-24T12:00:00Z",
  status: "pending",
};

function stub(monthlyIncome: number, usable = true): DocumentReport {
  return {
    kind: "pay_stub",
    issuer: "Northwind",
    periodEnd: "2026-10-03",
    monthlyIncome,
    fields: { grossPay: monthlyIncome },
    checks: [],
    fileName: "stub.pdf",
    readMethod: "pdf_text",
    bankMatch: "not_checked",
    signature: "none",
    usable,
  };
}

const integrity = { passed: true as const, hash: "shared-build" };
const tenant = { id: "maya", secret: "test-only-secret" };

test("a document the scanner counts that meets the question is accepted and signs yes", async () => {
  const decision = decide([stub(9000)], 2400, 3);
  const delivery = deliveryFromScan(decision);
  assert.equal(delivery.outcome, "accepted");
  assert.equal(delivery.action, "sign");
  if (delivery.action !== "sign") return;
  assert.equal(delivery.meets, true);
  const payload = await buildClaimPayload(
    request,
    tenant,
    { meets: delivery.meets, medianMonthlyIncome: decision.monthlyIncome, recurringPayers: ["Northwind"] },
    integrity,
    delivery.evidence,
  );
  assert.equal(payload.claim.result, true);
  assert.equal(payload.evidence.source, "document");
  const sent = JSON.stringify(payload);
  assert.equal(sent.includes("9000"), false);
  assert.equal(sent.includes("stub.pdf"), false);
  assert.equal(sent.includes("Northwind"), false);
  assert.equal(sent.includes("grossPay"), false);
});

test("a counted document under the requirement is a signed no and shows as declined", async () => {
  const decision = decide([stub(1000)], 2400, 3);
  assert.equal(decision.meets, false);
  assert.ok(decision.strength);
  const delivery = deliveryFromScan(decision);
  assert.deepEqual(
    { outcome: delivery.outcome, action: delivery.action, meets: delivery.action === "sign" ? delivery.meets : null },
    { outcome: "declined", action: "sign", meets: false },
  );
  if (delivery.action !== "sign") return;
  const payload = await buildClaimPayload(
    request,
    tenant,
    { meets: delivery.meets, medianMonthlyIncome: decision.monthlyIncome, recurringPayers: [] },
    integrity,
    delivery.evidence,
  );
  assert.equal(payload.claim.result, false);
  assert.equal(JSON.stringify(payload).includes("1000"), false);
});

test("a document the scanner rejects declines with no claim and no financial fields", () => {
  const decision = decide([stub(9000, false)], 2400, 3);
  assert.equal(decision.strength, null);
  const delivery = deliveryFromScan(decision);
  assert.deepEqual(delivery, { outcome: "declined", action: "decline" });
  const notice = declineNotice(request.id);
  assert.deepEqual(notice, { requestId: "request-a", declined: true });
  assert.deepEqual(Object.keys(notice).sort(), ["declined", "requestId"]);
  const sent = JSON.stringify(notice);
  assert.equal(sent.includes("9000"), false);
  assert.equal(sent.includes("stub.pdf"), false);
  assert.equal(sent.includes("grossPay"), false);
});
