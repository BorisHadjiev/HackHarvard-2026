import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { VerificationRequest } from "@ntk/shared";
import { clearReplyIndex, rememberTenantPhone } from "@ntk/messaging";
import { openStore } from "../lib/store";
import { declineRememberedRequest, handleTenantText } from "../lib/text-reply";

const request = (id: string, status: VerificationRequest["status"] = "pending"): VerificationRequest => ({
  id,
  nonce: `nonce-${id}`,
  requesterName: "Harbor View Apartments",
  audience: "landlord-portal",
  question: { type: "income_to_rent", rent: 2400, multiple: 3 },
  createdAt: "2026-10-17T19:29:18.353Z",
  expiresAt: "2026-10-24T19:29:18.353Z",
  status,
});

function text(body: string, handle = "+14702493501", kind = "user") {
  return {
    type: "message.received",
    data: {
      object: {
        content: { type: "text", text: body },
        sentBy: { handle, kind },
      },
    },
  };
}

function tempStore() {
  const dir = mkdtempSync(path.join(tmpdir(), "ntk-no-"));
  return { file: path.join(dir, "store.json"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a NO text declines the latest request and stores no claim, phone, or balance", async () => {
  const t = tempStore();
  try {
    clearReplyIndex();
    rememberTenantPhone("+1 470 249 3501", "daaf");
    const store = openStore(t.file);
    store.requests.set("daaf", request("daaf"));

    const result = await declineRememberedRequest(store, text(" NO! "));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { declined: true });

    const saved = store.requests.get("daaf")!;
    assert.equal(saved.status, "rejected");
    assert.equal(saved.result, undefined);
    assert.equal(store.usedNonces.has("nonce-daaf"), false);
    assert.equal("phone" in saved, false);

    const onDisk = readFileSync(t.file, "utf8");
    assert.equal(JSON.parse(onDisk).requests[0].status, "rejected");
    assert.equal(onDisk.includes("+14702493501"), false);
    assert.equal(onDisk.includes("4702493501"), false);
    assert.ok(!/"(income|monthlyIncome|medianMonthlyIncome|balance|deposits?|amount|tenant|device|account|phone)"\s*:/i.test(onDisk), onDisk);
  } finally {
    t.cleanup();
  }
});

test("NO does not replace a verified answer, and other texts do nothing", async () => {
  const t = tempStore();
  try {
    clearReplyIndex();
    rememberTenantPhone("+14702493501", "done");
    const store = openStore(t.file);
    const answered = request("done", "verified");
    answered.result = { answer: true, verifiedAt: "2026-10-17T19:29:02.578Z" };
    store.requests.set("done", answered);

    const blocked = await declineRememberedRequest(store, text("no."));
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, "already_answered");
    assert.equal(store.requests.get("done")?.status, "verified");
    assert.equal(store.requests.get("done")?.result?.answer, true);

    const ignored = await declineRememberedRequest(store, text("no thanks"));
    assert.deepEqual(ignored, { status: 200, body: { ignored: true } });
    assert.equal(store.requests.get("done")?.status, "verified");
  } finally {
    t.cleanup();
  }
});

test("YES still approves and a NO never calls approve", async () => {
  const approved: unknown[] = [];
  const declined: unknown[] = [];
  const approve = async (payload: unknown) => {
    approved.push(payload);
    return { status: 200, body: { ok: true, answer: true } };
  };
  const decline = async (payload: unknown) => {
    declined.push(payload);
    return { status: 200, body: { declined: true } };
  };

  const yes = await handleTenantText(text("YES"), "http://localhost:3000", { approve, decline });
  assert.equal(yes.status, 200);
  assert.equal(yes.body.answer, true);
  assert.equal(approved.length, 1);
  assert.equal(declined.length, 0);

  const no = await handleTenantText(text("no"), "http://localhost:3000", { approve, decline });
  assert.deepEqual(no.body, { declined: true });
  assert.equal(approved.length, 1);
  assert.equal(declined.length, 1);

  const other = await handleTenantText(text("maybe"), "http://localhost:3000", { approve, decline });
  assert.deepEqual(other, { status: 200, body: { ignored: true } });
  assert.equal(approved.length, 1);
  assert.equal(declined.length, 1);
});
