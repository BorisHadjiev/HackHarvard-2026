import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSigningKeys, signClaim, verifyClaim, pairwiseSubject, ClaimError, CLAIM_TTL_SECONDS } from "../src/index";
import type { ClaimPayload } from "../src/index";

const payload = (over: Partial<ClaimPayload> = {}): ClaimPayload => ({
  aud: "landlord-portal",
  nonce: "nonce-123",
  sub: "pairwise-id",
  claim: { type: "income_to_rent", multiple: 3, rent: 2400, result: true },
  evidence: { source: "bank", window_days: 90, method: "recurring deposits, median month" },
  build: { hash: "build-abc", integrity: "passed" },
  ...over,
});

const opts = { audience: "landlord-portal", expectedNonce: "nonce-123", trustedBuildHashes: ["build-abc"] };

async function expectCode(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (err: unknown) => err instanceof ClaimError && err.code === code);
}

test("a valid claim verifies and carries no dollar income", async () => {
  const { privateJwk, publicJwk } = await generateSigningKeys();
  const token = await signClaim(payload(), privateJwk);
  const claim = await verifyClaim(token, publicJwk, opts);
  assert.equal(claim.claim.result, true);
  assert.ok(!JSON.stringify(claim).includes("income\":"), "no raw income field");
});

test("a claim signed by a different key is rejected", async () => {
  const a = await generateSigningKeys();
  const b = await generateSigningKeys();
  const token = await signClaim(payload(), a.privateJwk);
  await expectCode(verifyClaim(token, b.publicJwk, opts), "bad_signature");
});

test("a tampered claim is rejected", async () => {
  const { privateJwk, publicJwk } = await generateSigningKeys();
  const token = await signClaim(payload({ claim: { type: "income_to_rent", multiple: 3, rent: 2400, result: false } }), privateJwk);
  const [h, body, sig] = token.split(".");
  const forged = JSON.parse(Buffer.from(body, "base64url").toString());
  forged.claim.result = true;
  const forgedToken = [h, Buffer.from(JSON.stringify(forged)).toString("base64url"), sig].join(".");
  await expectCode(verifyClaim(forgedToken, publicJwk, opts), "bad_signature");
});

test("wrong audience, wrong nonce and untrusted build are rejected", async () => {
  const { privateJwk, publicJwk } = await generateSigningKeys();
  await expectCode(verifyClaim(await signClaim(payload({ aud: "someone-else" }), privateJwk), publicJwk, opts), "wrong_audience");
  await expectCode(verifyClaim(await signClaim(payload({ nonce: "other" }), privateJwk), publicJwk, opts), "wrong_nonce");
  await expectCode(verifyClaim(await signClaim(payload({ build: { hash: "evil", integrity: "passed" } }), privateJwk), publicJwk, opts), "untrusted_build");
});

test("an expired claim is rejected", async () => {
  const { privateJwk, publicJwk } = await generateSigningKeys();
  const token = await signClaim(payload(), privateJwk, new Date("2026-01-01T00:00:00Z"));
  const later = new Date(Date.parse("2026-01-01T00:00:00Z") + (CLAIM_TTL_SECONDS + 60) * 1000);
  await expectCode(verifyClaim(token, publicJwk, { ...opts, now: later }), "expired");
});

test("pairwise subject differs per landlord and is stable", async () => {
  const a1 = await pairwiseSubject("tenant-secret", "landlord-a");
  const a2 = await pairwiseSubject("tenant-secret", "landlord-a");
  const b = await pairwiseSubject("tenant-secret", "landlord-b");
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
});
