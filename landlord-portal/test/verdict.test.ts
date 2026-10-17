import { test } from "node:test";
import assert from "node:assert/strict";
import type { VerificationRequest } from "@ntk/shared";
import { landlordVerdict } from "../lib/verdict";

function request(over: Partial<VerificationRequest> = {}): VerificationRequest {
  return {
    id: "r1",
    nonce: "n1",
    requesterName: "Harbor View Apartments",
    audience: "landlord-portal",
    question: { type: "income_to_rent", rent: 2400, multiple: 3 },
    createdAt: "2026-10-17T12:00:00.000Z",
    expiresAt: "2026-10-24T12:00:00.000Z",
    status: "pending",
    ...over,
  };
}

test("an accepted document scan shows accepted and meets", () => {
  const label = landlordVerdict(request({
    status: "verified",
    result: { answer: true, verifiedAt: "2026-10-17T15:00:00.000Z", evidence: "document_unverified" },
  }));
  assert.equal(label, "Accepted — meets the requirement");
});

test("a declined document scan shows declined", () => {
  const signedNo = landlordVerdict(request({
    status: "verified",
    result: { answer: false, verifiedAt: "2026-10-17T15:00:00.000Z", evidence: "document_bank_matched" },
  }));
  const rejected = landlordVerdict(request({ status: "rejected" }));
  assert.equal(signedNo, "Declined");
  assert.equal(rejected, "Declined");
});

test("bank answers keep their own yes and no lines", () => {
  assert.equal(
    landlordVerdict(request({
      status: "verified",
      result: { answer: true, verifiedAt: "2026-10-17T15:00:00.000Z", evidence: "bank" },
    })),
    "Yes — meets the requirement",
  );
  assert.equal(
    landlordVerdict(request({
      status: "verified",
      result: { answer: false, verifiedAt: "2026-10-17T15:00:00.000Z" },
    })),
    "No — does not meet the requirement",
  );
});
