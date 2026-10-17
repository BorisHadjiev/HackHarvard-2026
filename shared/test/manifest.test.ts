import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSigningKeys, signClaim, signManifest, verifyManifest } from "../src/index";

const manifest = { hash: "sha256:abc", files: { "tenant-app/lib/income.ts": "123" } };

test("a manifest signed by the release key verifies and round-trips", async () => {
  const { privateJwk, publicJwk } = await generateSigningKeys();
  assert.deepEqual(await verifyManifest(await signManifest(manifest, privateJwk), publicJwk), manifest);
});

test("a manifest signed by a different key is rejected", async () => {
  const release = await generateSigningKeys();
  const attacker = await generateSigningKeys();
  await assert.rejects(verifyManifest(await signManifest(manifest, attacker.privateJwk), release.publicJwk));
});

test("a signed claim can't be passed off as a manifest, even with the same key", async () => {
  const { privateJwk, publicJwk } = await generateSigningKeys();
  const claim = await signClaim(
    {
      aud: "a", nonce: "n", sub: "s",
      claim: { type: "income_to_rent", multiple: 3, rent: 1, result: true },
      evidence: { source: "bank", window_days: 90, method: "m" },
      build: { hash: "h", integrity: "passed" },
    },
    privateJwk,
  );
  await assert.rejects(verifyManifest(claim, publicJwk));
});
