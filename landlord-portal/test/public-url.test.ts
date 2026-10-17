import { test } from "node:test";
import assert from "node:assert/strict";
import { portalPublicOrigin } from "../lib/public-url";

function withPublicUrl(value: string | undefined, run: () => void) {
  const prev = process.env.PUBLIC_PORTAL_URL;
  if (value === undefined) delete process.env.PUBLIC_PORTAL_URL;
  else process.env.PUBLIC_PORTAL_URL = value;
  try {
    run();
  } finally {
    if (prev === undefined) delete process.env.PUBLIC_PORTAL_URL;
    else process.env.PUBLIC_PORTAL_URL = prev;
  }
}

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

test("PUBLIC_PORTAL_URL is the origin even behind a proxy", () => {
  withPublicUrl("https://need-to-know.onrender.com/", () => {
    const origin = portalPublicOrigin(
      req("http://10.0.0.3:10000/api/requests", {
        "x-forwarded-proto": "http",
        "x-forwarded-host": "internal.example",
      }),
    );
    assert.equal(origin, "https://need-to-know.onrender.com");
  });
});

test("proxy headers are used when PUBLIC_PORTAL_URL is unset", () => {
  withPublicUrl(undefined, () => {
    const origin = portalPublicOrigin(
      req("http://10.0.0.3:10000/api/requests", {
        "x-forwarded-proto": "https, http",
        "x-forwarded-host": "need-to-know.onrender.com, internal",
      }),
    );
    assert.equal(origin, "https://need-to-know.onrender.com");
  });
});

test("a blank PUBLIC_PORTAL_URL falls through to the proxy headers", () => {
  withPublicUrl("   ", () => {
    const origin = portalPublicOrigin(
      req("http://10.0.0.3:10000/api/requests", {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "need-to-know.onrender.com",
      }),
    );
    assert.equal(origin, "https://need-to-know.onrender.com");
  });
});

test("the request URL is used when the public URL and proxy headers are incomplete", () => {
  withPublicUrl(undefined, () => {
    const onlyProto = portalPublicOrigin(
      req("http://localhost:3000/api/requests", { "x-forwarded-proto": "https" }),
    );
    assert.equal(onlyProto, "http://localhost:3000");

    const direct = portalPublicOrigin(req("http://127.0.0.1:3000/api/requests"));
    assert.equal(direct, "http://127.0.0.1:3000");
  });
});
