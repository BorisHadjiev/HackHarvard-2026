import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import type { VerificationRequest } from "@ntk/shared";
import { openStore } from "../lib/store";

const request = (id: string): VerificationRequest => ({
  id,
  nonce: `nonce-${id}`,
  requesterName: "Harbor View Apartments",
  audience: "landlord-portal",
  question: { type: "income_to_rent", rent: 2400, multiple: 3 },
  createdAt: "2026-10-17T14:00:00.000Z",
  expiresAt: "2026-10-24T14:00:00.000Z",
  status: "pending",
});

function tempFile() {
  const dir = mkdtempSync(path.join(tmpdir(), "ntk-store-"));
  return { dir, file: path.join(dir, "nested", "store.json"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("requests, results and used one-time codes survive a restart", async () => {
  const t = tempFile();
  try {
    const a = openStore(t.file);
    a.requests.set("r1", request("r1"));
    await tick();
    const r = a.requests.get("r1")!;
    a.usedNonces.add(r.nonce);
    r.status = "verified";
    r.result = { answer: true, verifiedAt: "2026-10-17T14:05:00.000Z" };
    a.save();

    const b = openStore(t.file); // a fresh process reading the same file
    assert.equal(b.requests.get("r1")?.status, "verified");
    assert.equal(b.requests.get("r1")?.result?.answer, true);
    assert.ok(b.usedNonces.has("nonce-r1"), "a replay after restart must still be caught");
  } finally {
    t.cleanup();
  }
});

test("adding entries saves automatically, including in-place edits made in the same tick", async () => {
  const t = tempFile();
  try {
    const s = openStore(t.file);
    const r = request("r2");
    s.requests.set(r.id, r);
    r.status = "rejected"; // same tick as the set
    await tick();
    const onDisk = JSON.parse(readFileSync(t.file, "utf8"));
    assert.equal(onDisk.requests[0].status, "rejected");
  } finally {
    t.cleanup();
  }
});

test("the saved file holds no dollar amounts beyond the rent the landlord asked about", async () => {
  const t = tempFile();
  try {
    const s = openStore(t.file);
    s.requests.set("r3", request("r3"));
    s.save();
    const text = readFileSync(t.file, "utf8");
    assert.ok(!/"(income|monthlyIncome|medianMonthlyIncome|balance|deposits?|amount)"\s*:/i.test(text), text);
  } finally {
    t.cleanup();
  }
});

test("a corrupt store file is set aside instead of crashing the portal", () => {
  const t = tempFile();
  try {
    const s0 = openStore(t.file);
    s0.save();
    writeFileSync(t.file, "{not json");
    const s = openStore(t.file);
    assert.equal(s.requests.size, 0);
    assert.ok(readdirSync(path.dirname(t.file)).some((f) => f.includes(".corrupt-")));
  } finally {
    t.cleanup();
  }
});
