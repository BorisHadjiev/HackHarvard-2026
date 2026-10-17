// End-to-end check against running apps (`npm run dev` in another terminal), then `npm run smoke`.
// Covers the MVP gate: request -> approve -> verified, replay rejected, short income answers "no".
const PORTAL = process.env.PORTAL ?? "http://localhost:3000";
const TENANT = process.env.TENANT ?? "http://localhost:3001";

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${JSON.stringify(detail)}`}`);
  if (!ok) process.exitCode = 1;
}

const r1 = await post(`${PORTAL}/api/requests`, { rent: 2400, multiple: 3 });
check("landlord creates a request", r1.status === 201, r1);
const id = r1.json.request.id;

const a1 = await post(`${TENANT}/api/approve`, { requestId: id, portal: PORTAL, tenant: "maya" });
check("Maya approves and the portal verifies YES", a1.status === 200 && a1.json.answer === true, a1);

const status = await (await fetch(`${PORTAL}/api/requests/${id}`)).json();
check("portal stores the result without dollar amounts", status.result?.answer === true && !JSON.stringify(status).includes("8200"), status);
check("the answer was proven in zero knowledge (bank-signed deposits)", status.result?.proof === "zk", status.result);

const a2 = await post(`${TENANT}/api/approve`, { requestId: id, portal: PORTAL, tenant: "maya" });
check("a second answer to the same request is rejected (replay)", a2.status === 409 && a2.json.code === "replayed", a2);

const r2 = await post(`${PORTAL}/api/requests`, { rent: 2400, multiple: 3 });
const a3 = await post(`${TENANT}/api/approve`, { requestId: r2.json.request.id, portal: PORTAL, tenant: "leo" });
check("Leo (one-time transfer) is verified as NO", a3.status === 200 && a3.json.answer === false, a3);

const forged = await post(`${PORTAL}/api/claims`, { requestId: r2.json.request.id, token: "not.a.token" });
check("a forged token is rejected", forged.status >= 400 && forged.json.ok === false, forged);

// A local relay records the exact signed claim while forwarding it unchanged. Replaying that
// same token exercises the portal's nonce protection, rather than signing a second answer.
const { existsSync } = await import("node:fs");
if (!existsSync(new URL("../tenant-app/lib/documents/id-card.ts", import.meta.url))) {
  console.log("SKIP  age smoke: ID reader has not merged");
} else {
  const { createServer } = await import("node:http");
  const { ageSpecimens } = await import("./lib/sample-documents");
  let captured: { requestId: string; token: string } | undefined;
  const relay = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      if (req.url === "/api/claims") captured = JSON.parse(body);
      const upstream = await fetch(`${PORTAL}${req.url}`, {
        method: req.method, headers: { "content-type": "application/json" },
        ...(body ? { body } : {}),
      });
      res.writeHead(upstream.status, { "content-type": "application/json" });
      res.end(await upstream.text());
    } catch { res.writeHead(502); res.end('{"ok":false}'); }
  });
  await new Promise<void>(resolve => relay.listen(0, "127.0.0.1", resolve));
  try {
    const address = relay.address() as import("node:net").AddressInfo;
    const request = await post(`${PORTAL}/api/requests`, { type: "age_over" });
    check("landlord creates an age request", request.status === 201, request);
    const adult = (await ageSpecimens()).find(f => f.name === "adult-license-back.png")!;
    const form = new FormData();
    form.set("requestId", request.json.request.id);
    form.set("portal", `http://127.0.0.1:${address.port}`);
    form.set("mode", "age");
    form.set("tenant", "maya");
    form.append("documents", new Blob([Buffer.from(adult.data)], { type: adult.type }), adult.name);
    const approved = await fetch(`${TENANT}/api/approve`, { method: "POST", body: form });
    const result = await approved.json();
    check("adult specimen is verified YES end to end", approved.status === 200 && result.answer === true, result);
    const stored = await (await fetch(`${PORTAL}/api/requests/${request.json.request.id}`)).json();
    check("age result has fixed unverified document evidence", stored.result?.answer === true && stored.result?.evidence === "document_unverified", stored);
    check("tenant submitted a signed age claim", !!captured?.token);
    if (captured) {
      const replay = await post(`${PORTAL}/api/claims`, captured);
      check("replay of the exact age claim is rejected", replay.status === 409 && replay.json.code === "replayed", replay);
      const payload = JSON.parse(Buffer.from(captured.token.split(".")[1], "base64url").toString());
      check("age claim contains only the threshold and answer", JSON.stringify(Object.keys(payload.claim).sort()) === JSON.stringify(["min_age", "result", "type"]));
    }
  } finally { await new Promise<void>((resolve, reject) => relay.close(err => err ? reject(err) : resolve())); }
}
