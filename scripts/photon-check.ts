// Photon diagnostic: runs each step of a send and prints exactly where and why it fails.
// Usage: npx tsx scripts/photon-check.ts +16175550123
// Reads PHOTON_* from landlord-portal/.env.local (or the shell). Never prints the API key.
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { readPhotonConfig, normalizePhone, createPhotonClient, usesBetaPhotonApi } from "../messaging/src/index";

const envPath = fileURLToPath(new URL("../landlord-portal/.env.local", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

const phoneArg = process.argv[2];
if (!phoneArg) throw new Error("Pass the phone number to text, e.g. npx tsx scripts/photon-check.ts +16175550123");

const config = readPhotonConfig();
if (!config) throw new Error("PHOTON_API_KEY, PHOTON_PROJECT_ID and PHOTON_SENDER_ID must all be set in landlord-portal/.env.local");

console.log("project:", config.projectId, "| sender:", config.senderId, "| platform:", config.platform);
console.log("route:", usesBetaPhotonApi(config) ? "Photon beta API (pho_prj_ project)" : "Spectrum iMessage");
console.log("key looks like:", `${config.apiKey.slice(0, 7)}… (${config.apiKey.length} chars)`);

function explain(step: string, err: unknown) {
  const e = err as { message?: string; status?: number; requestId?: string; rawBody?: string; body?: unknown };
  console.log(`\nFAILED at step: ${step}`);
  console.log("status:", e.status ?? "(none)");
  console.log("message:", e.message);
  console.log("request id:", e.requestId ?? "(none)");
  console.log("response body:", e.rawBody ?? JSON.stringify(e.body ?? null));
  process.exit(1);
}

const client = createPhotonClient(config);
const handle = normalizePhone(phoneArg);
let userId = "";
let spaceId = "";
try { userId = (await client.createOrGetUser(handle, config.platform)).id; console.log("1/3 createOrGetUser OK:", userId); }
catch (err) { explain("1/3 createOrGetUser (register the tenant's phone)", err); }
try { spaceId = (await client.createOrGetSpace([config.senderId, userId], config.platform, randomUUID())).id; console.log("2/3 createOrGetSpace OK:", spaceId); }
catch (err) { explain("2/3 createOrGetSpace (open a chat between sender and tenant)", err); }
try { const sent = await client.sendMessage({ spaceId, senderId: config.senderId, text: "Need-to-Know test message", idempotencyKey: randomUUID() }); console.log("3/3 sendMessage OK:", sent.id); }
catch (err) { explain("3/3 sendMessage", err); }
console.log("\nAll steps passed: Photon works with these keys.");
