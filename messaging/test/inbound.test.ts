import { test } from "node:test";
import assert from "node:assert/strict";
import { clearReplyIndex, handleInboundNo, handleInboundYes, parseNoReply, parseYesReply, rememberTenantPhone, requestIdForPhone } from "../src/index";

function smsYes(text: string, handle = "+1 617 555 0123", kind = "human") {
  return {
    id: "evt_1",
    type: "message.received",
    apiVersion: "2026-07-01",
    source: "sms.photon",
    timestamp: "2026-10-17T15:00:00.000Z",
    data: {
      projectId: "pho_prj_test",
      object: {
        status: "received",
        platform: "sms",
        sentBy: { handle, kind },
        content: { type: "text", format: "plain", text },
      },
    },
  };
}

test("parseYesReply accepts a Photon SMS event and normalizes the phone", () => {
  assert.deepEqual(parseYesReply(smsYes(" YES! ")), { phone: "+16175550123" });
  assert.equal(parseYesReply(smsYes("no")), null);
  assert.equal(parseYesReply(smsYes("YES", "+16175550123", "agent")), null);
  assert.equal(parseYesReply({ hello: "world" }), null);
});

test("parseNoReply accepts the same plain-text shape as YES and ignores everything else", () => {
  assert.deepEqual(parseNoReply(smsYes(" NO. ")), { phone: "+16175550123" });
  assert.deepEqual(parseNoReply(smsYes("no!")), { phone: "+16175550123" });
  assert.deepEqual(parseNoReply(smsYes("No")), { phone: "+16175550123" });
  assert.equal(parseNoReply(smsYes("yes")), null);
  assert.equal(parseNoReply(smsYes("NO thanks")), null);
  assert.equal(parseNoReply(smsYes("no?")), null);
  assert.equal(parseNoReply(smsYes("NO!!")), null);
  assert.equal(parseNoReply(smsYes("NO", "+16175550123", "agent")), null);
  assert.equal(parseNoReply({ hello: "world" }), null);
});

test("the latest phone maps to one request and is not stored on the claim", () => {
  clearReplyIndex();
  rememberTenantPhone("+1 617 555 0123", "req-1");
  rememberTenantPhone("6175550123", "req-2");
  assert.equal(requestIdForPhone("+16175550123"), "req-2");
});

test("handleInboundYes approves the remembered request and strips local dollars", async () => {
  clearReplyIndex();
  rememberTenantPhone("+16175550123", "req-9");
  const seen: string[] = [];
  const result = await handleInboundYes(smsYes("yes"), {
    approve: async (requestId) => {
      seen.push(requestId);
      return { status: 200, body: { ok: true, answer: true, local: { medianMonthlyIncome: 8200, dataSource: "fixture" } } };
    },
  });
  assert.deepEqual(seen, ["req-9"]);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, answer: true });
  assert.equal(JSON.stringify(result.body).includes("8200"), false);
});

test("handleInboundYes does not approve a NO", async () => {
  clearReplyIndex();
  rememberTenantPhone("+16175550123", "req-9");
  const result = await handleInboundYes(smsYes("NO!"), {
    approve: async () => {
      throw new Error("should not approve");
    },
  });
  assert.deepEqual(result, { status: 200, body: { ignored: true } });
});

test("handleInboundNo declines the remembered request and drops local figures", async () => {
  clearReplyIndex();
  rememberTenantPhone("+1 470 249 3501", "req-no");
  const seen: string[] = [];
  const result = await handleInboundNo(smsYes("no", "+1 470 249 3501"), {
    decline: async (requestId) => {
      seen.push(requestId);
      return { status: 200, body: { declined: true, local: { medianMonthlyIncome: 8200 } } };
    },
  });
  assert.deepEqual(seen, ["req-no"]);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { declined: true });
  assert.equal(JSON.stringify(result.body).includes("8200"), false);
  assert.equal(JSON.stringify(result.body).includes("470"), false);
});

test("handleInboundNo ignores other texts, agent echoes, and unknown phones", async () => {
  clearReplyIndex();
  const ignored = await handleInboundNo(smsYes("hello"), {
    decline: async () => {
      throw new Error("should not decline");
    },
  });
  assert.deepEqual(ignored, { status: 200, body: { ignored: true } });

  const echo = await handleInboundNo(smsYes("NO", "+16175550123", "agent"), {
    decline: async () => {
      throw new Error("should not decline");
    },
  });
  assert.deepEqual(echo, { status: 200, body: { ignored: true } });

  const yes = await handleInboundNo(smsYes("YES"), {
    decline: async () => {
      throw new Error("should not decline");
    },
  });
  assert.deepEqual(yes, { status: 200, body: { ignored: true } });

  const missing = await handleInboundNo(smsYes("NO"), {
    decline: async () => ({ status: 200, body: { declined: true } }),
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "unknown_phone");
});

test("handleInboundYes ignores other texts and unknown phones", async () => {
  clearReplyIndex();
  const ignored = await handleInboundYes(smsYes("hello"), {
    approve: async () => {
      throw new Error("should not approve");
    },
  });
  assert.deepEqual(ignored, { status: 200, body: { ignored: true } });

  const missing = await handleInboundYes(smsYes("YES"), {
    approve: async () => ({ status: 200, body: { ok: true } }),
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "unknown_phone");
});
