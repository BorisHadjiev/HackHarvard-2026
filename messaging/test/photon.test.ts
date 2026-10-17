import { test } from "node:test";
import assert from "node:assert/strict";
import { deliverTenantLink, normalizePhone, readPhotonConfig, sendText, tenantText } from "../src/index";
import type { PhotonConfig, PhotonMessagingClient, PhotonPlatform } from "../src/index";

const config: PhotonConfig = {
  apiKey: "pho_sk_test",
  projectId: "pho_prj_test",
  senderId: "pho_usr_agent",
  platform: "sms",
};

function fakeClient(overrides: Partial<PhotonMessagingClient> = {}): PhotonMessagingClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async createOrGetUser(handle, platform) {
      calls.push(`user:${platform}:${handle}`);
      return { id: "pho_usr_tenant" };
    },
    async createOrGetSpace(participantIds, platform, idempotencyKey) {
      calls.push(`space:${platform}:${participantIds.join(",")}:${idempotencyKey}`);
      return { id: "pho_spc_1" };
    },
    async sendMessage(args) {
      calls.push(`msg:${args.senderId}:${args.spaceId}:${args.text}`);
      return { id: "pho_msg_1" };
    },
    ...overrides,
  };
}

test("normalizePhone accepts the portal placeholder and bare US numbers", () => {
  assert.equal(normalizePhone("+1 617 555 0123"), "+16175550123");
  assert.equal(normalizePhone("6175550123"), "+16175550123");
  assert.equal(normalizePhone("16175550123"), "+16175550123");
  assert.equal(normalizePhone("+16175550123"), "+16175550123");
});

test("normalizePhone rejects an empty number", () => {
  assert.throws(() => normalizePhone("   "), /empty/);
});

test("readPhotonConfig is null until the three keys are set", () => {
  assert.equal(readPhotonConfig({}), null);
  assert.equal(readPhotonConfig({ PHOTON_API_KEY: "k", PHOTON_PROJECT_ID: "p" }), null);
  const cfg = readPhotonConfig({
    PHOTON_API_KEY: " k ",
    PHOTON_PROJECT_ID: " p ",
    PHOTON_SENDER_ID: " u ",
  });
  assert.deepEqual(cfg, { apiKey: "k", projectId: "p", senderId: "u", platform: "sms" });
});

test("readPhotonConfig rejects an unknown platform", () => {
  assert.throws(
    () => readPhotonConfig({ PHOTON_API_KEY: "k", PHOTON_PROJECT_ID: "p", PHOTON_SENDER_ID: "u", PHOTON_PLATFORM: "rcs" }),
    /PHOTON_PLATFORM/,
  );
});

test("sendText resolves the user, opens a space, then sends the text", async () => {
  const client = fakeClient();
  const sent = await sendText("+1 617 555 0123", "open this link", config, client);
  assert.equal(sent.messageId, "pho_msg_1");
  assert.deepEqual(client.calls, [
    "user:sms:+16175550123",
    "space:sms:pho_usr_agent,pho_usr_tenant:ntk-space:sms:pho_usr_agent:pho_usr_tenant",
    "msg:pho_usr_agent:pho_spc_1:open this link",
  ]);
});

test("sendText forwards the configured platform", async () => {
  const client = fakeClient();
  const imessage: PhotonConfig = { ...config, platform: "imessage" satisfies PhotonPlatform };
  await sendText("+16175550123", "hi", imessage, client);
  assert.match(client.calls[0], /^user:imessage:/);
});

test("tenant text is the question summary plus the link", () => {
  assert.equal(tenantText("Harbor asks: is your income at least 3x $2,400 rent?", "http://localhost:3001/request/1"), "Harbor asks: is your income at least 3x $2,400 rent?\nhttp://localhost:3001/request/1");
});

test("deliverTenantLink logs when Photon is not configured", async () => {
  const lines: string[] = [];
  const result = await deliverTenantLink("+16175550123", "http://link", "summary", {
    config: null,
    log: (line) => lines.push(line),
  });
  assert.equal(result, "logged");
  assert.deepEqual(lines, ["[notify] would text +16175550123: summary -> http://link"]);
});

test("deliverTenantLink logs when there is no phone", async () => {
  const lines: string[] = [];
  const result = await deliverTenantLink(undefined, "http://link", "summary", {
    config,
    log: (line) => lines.push(line),
    send: async () => {
      throw new Error("should not send");
    },
  });
  assert.equal(result, "logged");
  assert.equal(lines[0], "[notify] would text (no phone): summary -> http://link");
});

test("deliverTenantLink sends when Photon is configured", async () => {
  const lines: string[] = [];
  let body = "";
  const result = await deliverTenantLink("617-555-0123", "http://link", "summary", {
    config,
    log: (line) => lines.push(line),
    send: async (phone, text) => {
      body = `${phone} ${text}`;
      return { messageId: "pho_msg_1" };
    },
  });
  assert.equal(result, "sent");
  assert.equal(body, "617-555-0123 summary\nhttp://link");
  assert.equal(lines[0], "[notify] texted 617-555-0123: summary -> http://link");
});

test("deliverTenantLink falls back to the log when Photon errors", async () => {
  const lines: string[] = [];
  const result = await deliverTenantLink("+16175550123", "http://link", "summary", {
    config,
    log: (line) => lines.push(line),
    send: async () => {
      throw new Error("upstream down");
    },
  });
  assert.equal(result, "logged");
  assert.match(lines[0], /Photon send failed \(upstream down\)/);
  assert.match(lines[1], /would text/);
});
