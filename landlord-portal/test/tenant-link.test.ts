import { test } from "node:test";
import assert from "node:assert/strict";
import { tenantVerificationLink } from "../lib/tenant-link";

test("the texted link opens the tenant verification page for that request", () => {
  const link = tenantVerificationLink("http://localhost:3001", "abc-123", "http://localhost:3000");
  assert.equal(link, "http://localhost:3001/request/abc-123?portal=http%3A%2F%2Flocalhost%3A3000");
});

test("a trailing slash on the tenant origin does not change the page", () => {
  const link = tenantVerificationLink("http://localhost:3001/", "abc-123", "http://localhost:3000");
  assert.equal(link, "http://localhost:3001/request/abc-123?portal=http%3A%2F%2Flocalhost%3A3000");
});
