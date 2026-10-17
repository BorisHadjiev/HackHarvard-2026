import { randomBytes, randomUUID } from "node:crypto";
import { decodeJwt } from "jose";
import { generateSigningKeys, signClaim, type VerificationRequest } from "../shared/src";
import { buildClaimPayload } from "../tenant-app/lib/claim";
import { evaluateIncome } from "../tenant-app/lib/income";
import { fixtureDeposits } from "../tenant-app/lib/nessie";
import { auditFields, matchClaims, scoreMatches, withinRandomNoise, type Payload } from "./lib/linkability";

const tenants = 20;
const trials = 1000;
const baseTime = new Date("2026-10-17T12:00:00Z");
const { privateJwk } = await generateSigningKeys(); // One key for the entire build.
const requests: VerificationRequest[] = ["landlord-a", "landlord-b"].map((audience) => ({
  id: randomUUID(), nonce: randomUUID(), audience, requesterName: audience,
  question: { type: "income_to_rent", rent: 2400, multiple: 3 },
  createdAt: baseTime.toISOString(), expiresAt: "2026-10-18T12:00:00Z", status: "pending",
}));

// Separate truth labels never enter auditFields or matchClaims.
const rows: Array<{ truth: string; a: Payload; b: Payload }> = [];
for (let i = 0; i < tenants; i++) {
  const tenant = { id: `synthetic-${i}`, secret: randomBytes(32).toString("hex") };
  const now = new Date(baseTime.getTime() + i * 60_000);
  const income = evaluateIncome(fixtureDeposits("maya", now), 2400, 3, now);
  if (!income.meets) throw new Error("Synthetic tenants must all pass");
  const payloads: Payload[] = [];
  for (const request of requests) {
    const payload = await buildClaimPayload(request, tenant, income, { passed: true, hash: "demo-shared-build" });
    // Different tenants sign at different minutes within one hour. signClaim
    // rounds iat to the UTC day, so those minutes must not link the claims.
    payloads.push(decodeJwt(await signClaim(payload, privateJwk, now)));
  }
  rows.push({ truth: tenant.id, a: payloads[0], b: payloads[1] });
}

// Fixed independent permutations make runs reproducible and prevent aligned
// array order from revealing the answer. Payload subjects/nonces remain fresh.
const left = Array.from({ length: tenants }, (_, i) => rows[(i + 7) % tenants]);
const right = Array.from({ length: tenants }, (_, i) => rows[(7 * i + 3) % tenants]);
const a = left.map((row) => row.a);
const b = right.map((row) => row.b);
const truthA = left.map((row) => row.truth);
const truthB = right.map((row) => row.truth);
const audit = auditFields(a, b);
const timing = audit.filter((row) => ["iat", "exp"].includes(row.field) && row.classification === "LINKING");
const linking = audit.filter((row) => row.classification === "LINKING" && !timing.includes(row));
const pct = (value: number) => `${(value * 100).toFixed(2)}%`;

console.log(`Collusion test: ${tenants} tenants, 2 landlords, 40 decoded JWT payloads, one shared signing key.`);
console.log("All tenants pass income >= 3 x $2,400. No servers, env files, or real bank data.");
console.log("\nField audit (A/B distinct values; overlaps indicate potential linking):");
console.table(audit.map((row) => ({
  field: row.field, classification: row.classification,
  A: row.distinctA, B: row.distinctB, overlap: row.sharedValues,
  note: timing.includes(row) ? "WARN: known timestamp risk" : "",
})));

const raw = matchClaims(a, b, { trials });
const rawAccuracy = scoreMatches(raw.assignments, truthA, truthB);
console.log(`Matching: ${trials} shuffled one-to-one trials, all ${raw.usedFields.length} nonconstant fields.`);
console.log(`All-field accuracy: ${pct(rawAccuracy)}; random baseline: 1/${tenants} = ${pct(1 / tenants)}.`);
if (timing.length) {
  console.warn(`WARN: ${timing.map((row) => row.field).join(", ")} link tenants by signing time. signClaim should keep iat at UTC midnight and derive exp from it.`);
  console.warn("WARN: These timing fields are exempted from this demo's verdict; the full payloads are timing-linkable until that rounding holds.");
}
const adjusted = matchClaims(a, b, { trials, excludeFields: timing.map((row) => row.field) });
const accuracy = scoreMatches(adjusted.assignments, truthA, truthB);
console.log(`Timing-exempt accuracy: ${pct(accuracy)}; fields used: ${adjusted.usedFields.join(", ") || "none"}.`);
const noise = withinRandomNoise(accuracy, tenants, trials);
const passed = !linking.length && noise;
console.log(`${passed ? "PASS" : "FAIL"}${timing.length ? " (known timing risk exempted)" : ""}: ${linking.length ? `linking fields: ${linking.map((row) => row.field).join(", ")}` : "no other linking fields"}; ${noise ? "matching is within random noise" : `matching exceeds random noise; inspect ${adjusted.usedFields.join(", ")}`}.`);
console.log("Scope: equality-based payload matching on this synthetic cohort; excludes network metadata, timing exemptions, and other attacks. This is not a proof of universal unlinkability.");
if (!passed) process.exitCode = 1;
console.log(`Even if every website compares notes, they can’t track you. Measured accuracy: ${pct(accuracy)} (random: 5.00%; timing-exempt${timing.length ? `; all-field: ${pct(rawAccuracy)}` : ""}).`);
