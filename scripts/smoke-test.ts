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
