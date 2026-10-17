import { NextResponse } from "next/server";
import { verifyClaim, ClaimError } from "@ntk/shared";
import { store } from "@/lib/store";
import { portalConfig } from "@/lib/config";

// The tenant app posts { requestId, token } here. The portal never sees dollar amounts.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const request = store.requests.get(String(body.requestId ?? ""));
  if (!request) return NextResponse.json({ ok: false, code: "unknown_request" }, { status: 404 });

  if (store.usedNonces.has(request.nonce)) {
    return NextResponse.json({ ok: false, code: "replayed", message: "This one-time code was already used" }, { status: 409 });
  }
  if (Date.parse(request.expiresAt) < Date.now()) {
    return NextResponse.json({ ok: false, code: "request_expired" }, { status: 410 });
  }

  const cfg = portalConfig();
  try {
    const claim = await verifyClaim(String(body.token ?? ""), cfg.tenantPublicJwk, {
      audience: cfg.audience,
      expectedNonce: request.nonce,
      trustedBuildHashes: cfg.trustedBuildHashes,
    });
    if (claim.claim.rent !== request.question.rent || claim.claim.multiple !== request.question.multiple) {
      return NextResponse.json({ ok: false, code: "wrong_question" }, { status: 400 });
    }
    // Check again: two answers sent at once could both pass the first check while verifyClaim awaited.
    if (store.usedNonces.has(request.nonce)) {
      return NextResponse.json({ ok: false, code: "replayed", message: "This one-time code was already used" }, { status: 409 });
    }
    store.usedNonces.add(request.nonce);
    request.status = "verified";
    request.result = { answer: claim.claim.result, verifiedAt: new Date().toISOString(), evidence: claim.evidence.strength };
    store.save(); // the used nonce must be on disk before we answer, or a restart would allow a replay
    return NextResponse.json({ ok: true, answer: claim.claim.result, evidence: claim.evidence.strength });
  } catch (err) {
    if (err instanceof ClaimError) {
      return NextResponse.json({ ok: false, code: err.code, message: err.message }, { status: 400 });
    }
    throw err;
  }
}
