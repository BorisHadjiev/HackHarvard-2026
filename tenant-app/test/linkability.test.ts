import { test } from "node:test";
import assert from "node:assert/strict";
import { auditFields, flattenPayload, matchClaims, scoreMatches, withinRandomNoise, type Payload } from "../../scripts/lib/linkability";

function cohort(leaky = false) {
  const orderA = Array.from({ length: 20 }, (_, i) => (i + 7) % 20);
  const orderB = Array.from({ length: 20 }, (_, i) => (7 * i + 3) % 20);
  const payload = (i: number, audience: string): Payload => ({
    aud: audience, nonce: `nonce-${audience}`, sub: `${audience}-subject-${i}`,
    claim: { result: true }, build: { hash: "shared-build" }, iat: 3600,
    ...(leaky ? { tenant_id: `tenant-${i}` } : {}),
  });
  return {
    a: orderA.map((i) => payload(i, "a")), b: orderB.map((i) => payload(i, "b")),
    truthA: orderA.map(String), truthB: orderB.map(String),
  };
}

test("clean cohort has no linking fields and matches near the 5% baseline", () => {
  const { a, b, truthA, truthB } = cohort();
  const fields = auditFields(a, b);
  assert.equal(fields.some((row) => row.classification === "LINKING"), false);
  assert.equal(fields.find((row) => row.field === "claim.result")?.classification, "same for everyone");
  assert.equal(fields.find((row) => row.field === "aud")?.classification, "different per landlord");
  assert.equal(fields.find((row) => row.field === "sub")?.classification, "different per landlord");
  const attack = matchClaims(a, b);
  assert.deepEqual(attack.usedFields, ["aud", "nonce", "sub"]);
  const accuracy = scoreMatches(attack.assignments, truthA, truthB);
  assert.ok(Math.abs(accuracy - 0.05) < 0.01, String(accuracy));
  assert.ok(withinRandomNoise(accuracy, 20, 1000));
  assert.deepEqual(matchClaims(a, b), attack, "pure simulation is reproducible");
});

test("a tenant ID shared across landlords is LINKING and produces 100% accuracy", () => {
  const { a, b, truthA, truthB } = cohort(true);
  assert.equal(auditFields(a, b).find((row) => row.field === "tenant_id")?.classification, "LINKING");
  const attack = matchClaims(a, b);
  assert.equal(scoreMatches(attack.assignments, truthA, truthB), 1);
  assert.equal(withinRandomNoise(1, 20, 1000), false);
});

test("exact iat and derived exp expose timing links; exclusion does not hide other leaks", () => {
  const { a, b, truthA, truthB } = cohort(true);
  for (const [payloads, truths] of [[a, truthA], [b, truthB]] as const) {
    payloads.forEach((payload, i) => { payload.iat = 3600 + Number(truths[i]) * 60; payload.exp = Number(payload.iat) + 604800; });
  }
  const fields = auditFields(a, b);
  assert.deepEqual(fields.filter((row) => row.classification === "LINKING").map((row) => row.field), ["exp", "iat", "tenant_id"]);
  assert.equal(scoreMatches(matchClaims(a, b, { excludeFields: ["iat", "exp"] }).assignments, truthA, truthB), 1);
  for (const payload of [...a, ...b]) delete payload.tenant_id;
  assert.equal(scoreMatches(matchClaims(a, b).assignments, truthA, truthB), 1);
  assert.ok(withinRandomNoise(scoreMatches(matchClaims(a, b, { excludeFields: ["iat", "exp"] }).assignments, truthA, truthB), 20, 1000));
});

test("nested and optional field values are audited, including missingness", () => {
  assert.deepEqual(flattenPayload({ a: { b: ["id", null] }, empty: {} }), { "a.b.0": '"id"', "a.b.1": "null", empty: "{}" });
  const a = [{ private: { device: "first" } }, {}];
  assert.equal(auditFields(a, [...a].reverse()).find((row) => row.field === "private.device")?.classification, "LINKING");
});

test("matching validates input and scoring rejects non-bijective assignments", () => {
  assert.throws(() => matchClaims([], []), /nonempty/);
  assert.throws(() => matchClaims([{}], [{}, {}]), /equally sized/);
  assert.throws(() => matchClaims([{}], [{}], { trials: 0 }), /positive integer/);
  assert.throws(() => scoreMatches([[0, 0]], ["a", "b"], ["a", "b"]), /one-to-one/);
});
