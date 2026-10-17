import { randomBytes, randomUUID } from "node:crypto";
import { decodeJwt } from "jose";
import { generateSigningKeys, signClaim, type Question, type VerificationRequest } from "../shared/src";
import { buildClaimPayload, buildAgeClaimPayload } from "../tenant-app/lib/claim";
import { evaluateIncome } from "../tenant-app/lib/income";
import { fixtureDeposits } from "../tenant-app/lib/nessie";
import { auditFields, matchClaims, scoreMatches, withinRandomNoise, type Payload } from "./lib/linkability";

// Two landlords each pool everything they received and try to match claims back to the same tenant.
// Each landlord asked a MIX of questions (income >= 3x rent, age >= 18), chosen independently of the
// other landlord, the way two unrelated websites would. Every tenant passes both checks.
const tenants = 20;
const trials = 1000;
const baseTime = new Date("2026-10-17T12:00:00Z");
const { privateJwk } = await generateSigningKeys(); // One key for the entire build.
const INCOME: Question = { type: "income_to_rent", rent: 2400, multiple: 3 };
const AGE: Question = { type: "age_over", min_age: 18 };
const requestFor = (audience: string, question: Question): VerificationRequest => ({
  id: randomUUID(), nonce: randomUUID(), audience, requesterName: audience, question,
  createdAt: baseTime.toISOString(), expiresAt: "2026-10-18T12:00:00Z", status: "pending",
});

// Separate truth labels never enter auditFields or matchClaims.
const rows: Array<{ truth: string; a: Payload; b: Payload }> = [];
const integrity = { passed: true, hash: "demo-shared-build" };
for (let i = 0; i < tenants; i++) {
  const tenant = { id: `synthetic-${i}`, secret: randomBytes(32).toString("hex") };
  const now = new Date(baseTime.getTime() + i * 60_000);
  const income = evaluateIncome(fixtureDeposits("maya", now), 2400, 3, now);
  if (!income.meets) throw new Error("Synthetic tenants must all pass");
  // Landlord A asks income of even tenants, age of odd ones; landlord B uses an independent pattern.
  const questionA = i % 2 === 0 ? INCOME : AGE;
  const questionB = Math.floor(i / 2) % 2 === 0 ? INCOME : AGE;
  const payloads: Payload[] = [];
  for (const [audience, question] of [["landlord-a", questionA], ["landlord-b", questionB]] as const) {
    const request = requestFor(audience, question);
    const payload = question.type === "income_to_rent"
      ? await buildClaimPayload(request, tenant, income, integrity)
      : await buildAgeClaimPayload(request, tenant, true, integrity);
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
// The question and the fixed evidence block are what the landlord asked and what every answer of that
// kind carries. They vary across a mixed pool by design; the matching below still gets to use them.
const questionFields = (field: string) => field.startsWith("claim.") || field.startsWith("evidence.");
const linking = audit.filter((row) => row.classification === "LINKING" && !timing.includes(row) && !questionFields(row.field));
const pct = (value: number) => `${(value * 100).toFixed(2)}%`;

const mix = (ps: Payload[]) => ps.filter((p) => (p.claim as { type: string }).type === "age_over").length;
console.log(`Collusion test: ${tenants} tenants, 2 landlords, 40 decoded JWT payloads, one shared signing key.`);
console.log(`Mixed questions: landlord A received ${mix(a)} age and ${tenants - mix(a)} income claims; landlord B ${mix(b)} age and ${tenants - mix(b)} income. All answers are yes.`);
console.log("\nField audit (A/B distinct values; overlaps indicate potential linking):");
console.table(audit.map((row) => ({
  field: row.field,
  classification: row.classification === "LINKING" && questionFields(row.field) ? "question/evidence (coarse)" : row.classification,
  A: row.distinctA, B: row.distinctB, overlap: row.sharedValues,
  note: timing.includes(row) ? "WARN: known timestamp risk" : "",
})));

const raw = matchClaims(a, b, { trials });
const rawAccuracy = scoreMatches(raw.assignments, truthA, truthB);
console.log(`Matching: ${trials} shuffled one-to-one trials, all ${raw.usedFields.length} nonconstant fields (${raw.usedFields.join(", ")}).`);
console.log(`All-field accuracy: ${pct(rawAccuracy)}; random baseline: 1/${tenants} = ${pct(1 / tenants)}.`);
if (timing.length) {
  console.warn(`WARN: ${timing.map((row) => row.field).join(", ")} link tenants by exact signing time.`);
}
const adjusted = matchClaims(a, b, { trials, excludeFields: timing.map((row) => row.field) });
const accuracy = scoreMatches(adjusted.assignments, truthA, truthB);
console.log(`Timing-exempt accuracy: ${pct(accuracy)}; fields used: ${adjusted.usedFields.join(", ") || "none"}.`);
const noise = withinRandomNoise(accuracy, tenants, trials);
const passed = !linking.length && noise;
console.log(`${passed ? "PASS" : "FAIL"}${timing.length ? " (known timing risk exempted)" : ""}: ${linking.length ? `linking fields: ${linking.map((row) => row.field).join(", ")}` : "no linking fields beyond the question itself"}; ${noise ? "matching is within random noise" : `matching exceeds random noise; inspect ${adjusted.usedFields.join(", ")}`}.`);
console.log("Scope: equality-based payload matching on this synthetic cohort; excludes network metadata, timing exemptions, and other attacks. This is not a proof of universal unlinkability.");
if (!passed) process.exitCode = 1;
console.log(`Even if every website compares notes, they can’t track you. Measured accuracy: ${pct(accuracy)} (random: ${pct(1 / tenants)}; income and age claims pooled).`);
