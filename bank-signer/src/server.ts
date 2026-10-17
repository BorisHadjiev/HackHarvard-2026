// The stand-in bank. Owner: Sam.
// POST /attest { account, salt, asOfDay } -> { deposits, attestation }
// Reads the account's deposits (Nessie, or demo fixtures), commits to them with the tenant's
// salt, and signs the commitment with the BANK key. Runs on :3002 next to the two apps.
// In production this endpoint belongs to the bank; the tenant app would never see its key.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { commitDeposits, circuitId, dayNumber } from "@ntk/zk";
import { signAttestation } from "./attest";
import { toZkDeposits } from "./server-pure";
import { fetchDeposits, DEMO_TENANTS, type DemoTenant } from "../../tenant-app/lib/nessie";

// Load bank-signer/.env.local (bank key) and tenant-app/.env.local (Nessie settings) if present.
function loadEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0 || line.startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (process.env[k] === undefined) process.env[k] = line.slice(i + 1).trim().replace(/^'(.*)'$/, "$1");
  }
}
const root = path.resolve(new URL("../..", import.meta.url).pathname);
loadEnv(path.join(root, "bank-signer/.env.local"));
loadEnv(path.join(root, "tenant-app/.env.local"));

const port = Number(process.env.BANK_SIGNER_PORT ?? 3002);
const raw = process.env.BANK_SIGNER_PRIVATE_JWK;
if (!raw) {
  console.error("BANK_SIGNER_PRIVATE_JWK is missing. Run `npm run keys` at the repo root.");
  process.exit(1);
}
const bankKey = JSON.parse(raw);

const server = createServer(async (req, res) => {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/") return json(200, { ok: true, service: "need-to-know bank signer (demo stand-in)" });
  if (req.method !== "POST" || req.url !== "/attest") return json(404, { error: "not found" });
  let body: { account?: string; salt?: string; asOfDay?: number } = {};
  try {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return json(400, { error: "bad json" });
  }
  const account = String(body.account ?? "");
  if (!(account in DEMO_TENANTS)) return json(404, { error: "unknown account" });
  let salt: bigint;
  try {
    salt = BigInt(String(body.salt));
  } catch {
    return json(400, { error: "salt must be a field element" });
  }
  const asOfDay = Number.isInteger(body.asOfDay) ? Number(body.asOfDay) : dayNumber(new Date().toISOString());
  const todayNumber = dayNumber(new Date().toISOString());
  if (Math.abs(asOfDay - todayNumber) > 1) return json(400, { error: "asOfDay must be today" });

  try {
    const { deposits, source } = await fetchDeposits(account as DemoTenant);
    const zk = toZkDeposits(deposits);
    const commitment = await commitDeposits(zk, salt);
    const attestation = await signAttestation({ commitment, asOfDay, circuit: circuitId() }, bankKey);
    // The tenant gets the deposits back (it's their data) plus the signature to forward to the landlord.
    return json(200, { source, deposits: zk.map((d) => ({ amountCents: d.amountCents, day: d.day, payer: d.payer.toString() })), attestation });
  } catch (err) {
    return json(502, { error: (err as Error).message });
  }
});

server.listen(port, () => console.log(`[bank-signer] listening on http://localhost:${port} (demo stand-in for the bank)`));
