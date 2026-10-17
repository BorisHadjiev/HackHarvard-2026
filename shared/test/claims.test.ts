import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeJwt } from "jose";
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

test("claims signed at any time on the same UTC day have identical iat (and exp)", async () => {
  const { privateJwk } = await generateSigningKeys();
  const sign = async (when: string) => decodeJwt(await signClaim(payload(), privateJwk, new Date(when)));
  const midnight = Date.parse("2026-10-17T00:00:00Z") / 1000;
  // 10 minutes apart, and morning vs. night: neither can be told apart.
  for (const when of ["2026-10-17T14:20:00Z", "2026-10-17T14:30:00Z", "2026-10-17T03:15:00Z", "2026-10-17T21:40:00Z", "2026-10-17T23:59:59.999Z"]) {
    const c = await sign(when);
    assert.equal(c.iat, midnight, `${when} should round down to the start of its UTC day`);
    assert.equal(c.exp, midnight + CLAIM_TTL_SECONDS);
  }
  assert.equal((await sign("2026-10-18T00:00:00Z")).iat, midnight + 86_400, "the next UTC day gets the next iat");
});

test("iat is always a multiple of 86400 (so also of 3600) and exp is iat + CLAIM_TTL_SECONDS", async () => {
  const { privateJwk } = await generateSigningKeys();
  const edges = ["2026-10-17T00:00:00.000Z", "2026-10-17T00:00:00.001Z", "2026-10-17T23:59:59.999Z", "2026-12-31T23:30:00Z", "2028-02-29T12:00:00.500Z"];
  const random = Array.from({ length: 50 }, () => new Date(Date.UTC(2026, 0, 1) + Math.floor(Math.random() * 3 * 365 * 86_400_000)));
  for (const when of [...edges.map((d) => new Date(d)), ...random]) {
    const { iat, exp } = decodeJwt(await signClaim(payload(), privateJwk, when));
    const t = when.getTime() / 1000;
    assert.equal(iat! % 86_400, 0, `iat for ${when.toISOString()} is not UTC midnight`);
    assert.equal(iat! % 3600, 0);
    assert.ok(iat! <= t && t - iat! < 86_400, `iat for ${when.toISOString()} is not the start of its UTC day`);
    assert.equal(exp, iat! + CLAIM_TTL_SECONDS);
  }
});

test("a claim signed at 12:59 verifies until its exp, and not after", async () => {
  const { privateJwk, publicJwk } = await generateSigningKeys();
  const signedAt = new Date("2026-10-17T12:59:00Z");
  const token = await signClaim(payload(), privateJwk, signedAt);
  const { exp } = decodeJwt(token);
  assert.equal(exp, Date.parse("2026-10-17T00:00:00Z") / 1000 + CLAIM_TTL_SECONDS);

  const at = (unixSeconds: number) => ({ ...opts, now: new Date(unixSeconds * 1000) });
  await verifyClaim(token, publicJwk, { ...opts, now: signedAt }); // right after signing
  await verifyClaim(token, publicJwk, at(exp! - 1)); // last valid second
  await expectCode(verifyClaim(token, publicJwk, at(exp!)), "expired");
});

test("even a claim signed just before UTC midnight stays valid for more than 6 days", async () => {
  const { privateJwk, publicJwk } = await generateSigningKeys();
  const signedAt = new Date("2026-10-17T23:59:59Z");
  const token = await signClaim(payload(), privateJwk, signedAt);
  const sixDaysLater = new Date(signedAt.getTime() + 6 * 86_400_000);
  await verifyClaim(token, publicJwk, { ...opts, now: sixDaysLater });
});
