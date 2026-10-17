import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateSigningKeys, signManifest } from "@ntk/shared";
import { hashSourceFiles, findRepoRoot } from "../lib/build-hash";
import { checkIntegrityAt, MANIFEST_FILE, UNSIGNED_DEV_HASH } from "../lib/integrity";

/** A tiny fake repo: tenant-app/app, tenant-app/lib and shared/src with one file each. */
function fakeRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "ntk-integrity-"));
  const put = (rel: string, body: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  };
  put("tenant-app/app/page.tsx", "export default function Page() { return null; }\n");
  put("tenant-app/lib/income.ts", "export const meets = (a: number, b: number) => a >= b;\n");
  put("shared/src/claims.ts", "export const CLAIM_ALG = 'EdDSA';\n");
  put("tenant-app/.env.local", "SECRET=not-hashed\n");
  return { root, put, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function signRepo(root: string) {
  const keys = await generateSigningKeys();
  const jws = await signManifest(hashSourceFiles(root), keys.privateJwk);
  writeFileSync(path.join(root, MANIFEST_FILE), JSON.stringify({ version: 1, jws }));
  return keys;
}

test("the hash is stable and ignores files outside the hashed folders", () => {
  const repo = fakeRepo();
  try {
    const a = hashSourceFiles(repo.root);
    repo.put("tenant-app/.env.local", "SECRET=changed\n");
    repo.put("tenant-app/notes.txt", "not code\n");
    assert.equal(hashSourceFiles(repo.root).hash, a.hash);
    assert.match(a.hash, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(a.files), ["shared/src/claims.ts", "tenant-app/app/page.tsx", "tenant-app/lib/income.ts"]);
  } finally {
    repo.cleanup();
  }
});

test("an untouched signed build passes and reports its real hash", async () => {
  const repo = fakeRepo();
  try {
    const { publicJwk } = await signRepo(repo.root);
    const r = await checkIntegrityAt({ root: repo.root, releasePublicJwk: publicJwk, requireSigned: true });
    assert.equal(r.passed, true, r.reason);
    assert.equal(r.hash, hashSourceFiles(repo.root).hash);
  } finally {
    repo.cleanup();
  }
});

test("editing one line of income.ts makes the app refuse to sign and names the file", async () => {
  const repo = fakeRepo();
  try {
    const { publicJwk } = await signRepo(repo.root);
    appendFileSync(path.join(repo.root, "tenant-app/lib/income.ts"), "export const alwaysYes = true;\n");
    const r = await checkIntegrityAt({ root: repo.root, releasePublicJwk: publicJwk, requireSigned: true });
    assert.equal(r.passed, false);
    assert.match(r.reason ?? "", /refusing to sign/);
    assert.match(r.reason ?? "", /tenant-app\/lib\/income\.ts/);
  } finally {
    repo.cleanup();
  }
});

test("adding a new source file is also caught", async () => {
  const repo = fakeRepo();
  try {
    const { publicJwk } = await signRepo(repo.root);
    repo.put("tenant-app/lib/backdoor.ts", "export {};\n");
    const r = await checkIntegrityAt({ root: repo.root, releasePublicJwk: publicJwk, requireSigned: true });
    assert.equal(r.passed, false);
    assert.match(r.reason ?? "", /backdoor\.ts/);
  } finally {
    repo.cleanup();
  }
});

test("a manifest re-signed with someone else's key is rejected", async () => {
  const repo = fakeRepo();
  try {
    const release = await generateSigningKeys();
    await signRepo(repo.root); // signed with a different, attacker key
    const r = await checkIntegrityAt({ root: repo.root, releasePublicJwk: release.publicJwk, requireSigned: true });
    assert.equal(r.passed, false);
    assert.match(r.reason ?? "", /signature is invalid/);
  } finally {
    repo.cleanup();
  }
});

test("a missing manifest fails when a signed build is required, and is an unsigned dev build otherwise", async () => {
  const repo = fakeRepo();
  try {
    const strict = await checkIntegrityAt({ root: repo.root, requireSigned: true });
    assert.equal(strict.passed, false);
    assert.match(strict.reason ?? "", /refusing to sign/);
    const dev = await checkIntegrityAt({ root: repo.root, requireSigned: false });
    assert.equal(dev.passed, true);
    assert.equal(dev.hash, UNSIGNED_DEV_HASH);
  } finally {
    repo.cleanup();
  }
});

test("the real repo hashes the tenant app and shared code", () => {
  const { files } = hashSourceFiles(findRepoRoot(__dirname));
  assert.ok(files["tenant-app/lib/income.ts"]);
  assert.ok(files["tenant-app/lib/integrity.ts"]);
  assert.ok(files["shared/src/claims.ts"]);
  assert.ok(!Object.keys(files).some((f) => f.includes(".env") || f.startsWith("tenant-app/test/")));
});
