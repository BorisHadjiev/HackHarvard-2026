import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { VerificationRequest } from "@ntk/shared";
import { openStore } from "../lib/store";
import { declineRequest, readDecline } from "../lib/decline";

const request = (id: string, status: VerificationRequest["status"] = "pending"): VerificationRequest => ({
  id,
  nonce: `nonce-${id}`,
  requesterName: "Harbor View Apartments",
  audience: "landlord-portal",
  question: { type: "income_to_rent", rent: 2400, multiple: 3 },
  createdAt: "2026-10-17T14:00:00.000Z",
  expiresAt: "2026-10-24T14:00:00.000Z",
  status,
});

function tempFile() {
  const dir = mkdtempSync(path.join(tmpdir(), "ntk-decline-"));
  return { dir, file: path.join(dir, "store.json"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a decline is stored as rejected, with no financial fields and no used nonce", () => {
  const t = tempFile();
  try {
    const store = openStore(t.file);
    store.requests.set("r1", request("r1"));
    const outcome = declineRequest(store, "r1");
    assert.deepEqual(outcome, { ok: true });
    const saved = store.requests.get("r1")!;
    assert.equal(saved.status, "rejected");
    assert.equal(saved.result, undefined);
    assert.equal(store.usedNonces.has("nonce-r1"), false);

    const onDisk = readFileSync(t.file, "utf8");
    assert.equal(JSON.parse(onDisk).requests[0].status, "rejected");
    assert.ok(!/"(income|monthlyIncome|medianMonthlyIncome|balance|deposits?|amount|tenant|device|account)"\s*:/i.test(onDisk), onDisk);
  } finally {
    t.cleanup();
  }
});

test("declining twice stays declined and does not change a verified answer", () => {
  const t = tempFile();
  try {
    const store = openStore(t.file);
    store.requests.set("open", request("open"));
    declineRequest(store, "open");
    declineRequest(store, "open");
    assert.equal(store.requests.get("open")?.status, "rejected");

    const answered = request("done", "verified");
    answered.result = { answer: false, verifiedAt: "2026-10-17T15:00:00.000Z" };
    store.requests.set("done", answered);
    const blocked = declineRequest(store, "done");
    assert.deepEqual(blocked, { ok: false, code: "already_answered" });
    assert.equal(store.requests.get("done")?.status, "verified");
    assert.equal(store.requests.get("done")?.result?.answer, false);
    assert.deepEqual(declineRequest(store, "missing"), { ok: false, code: "unknown_request" });
  } finally {
    t.cleanup();
  }
});

test("the portal accepts only a request id and declined: true", () => {
  assert.deepEqual(readDecline({ requestId: "r1", declined: true }), { requestId: "r1" });
  assert.equal(readDecline({ requestId: "r1", declined: true, tenant: "maya" }), null);
  assert.equal(readDecline({ requestId: "r1", declined: true, amount: 8200 }), null);
  assert.equal(readDecline({ requestId: "r1" }), null);
  assert.equal(readDecline({ declined: true }), null);
  assert.equal(readDecline(null), null);
});
