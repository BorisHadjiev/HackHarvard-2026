import { NextResponse } from "next/server";
import { verifyClaim, ClaimError } from "@ntk/shared";
import { store } from "@/lib/store";
import { portalConfig } from "@/lib/config";
import { checkProof, looksLikeProof } from "@/lib/proof";

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

    // Bank-backed answers must be proven in zero knowledge over bank-signed deposits, when we know a bank key.
    // Then the signed yes/no can't be faked: the bank signed the data, the proof applied the rule, and both are
    // bound to this request's one-time code.
    let proven = false;
    const zk = body.zk;
    if (cfg.trustedBankKeys.length > 0 && claim.evidence.strength === "bank") {
      if (!looksLikeProof(zk)) {
        return NextResponse.json({ ok: false, code: "proof_required", message: "This portal only accepts bank-backed answers with a zero-knowledge proof" }, { status: 400 });
      }
      const check = await checkProof(zk, request, cfg.trustedBankKeys);
      if (!check.ok) return NextResponse.json({ ok: false, code: check.code, message: check.message }, { status: 400 });
      if (check.result !== claim.claim.result) {
        return NextResponse.json({ ok: false, code: "proof_mismatch", message: "The signed answer doesn't match what the proof shows" }, { status: 400 });
      }
      proven = true;
    }
    // Check again: two answers sent at once could both pass the first check while verifyClaim awaited.
    if (store.usedNonces.has(request.nonce)) {
      return NextResponse.json({ ok: false, code: "replayed", message: "This one-time code was already used" }, { status: 409 });
    }
    store.usedNonces.add(request.nonce);
    request.status = "verified";
    request.result = { answer: claim.claim.result, verifiedAt: new Date().toISOString(), evidence: claim.evidence.strength, ...(proven ? { proof: "zk" as const } : {}) };
    store.save(); // the used nonce must be on disk before we answer, or a restart would allow a replay
    return NextResponse.json({ ok: true, answer: claim.claim.result, evidence: claim.evidence.strength, proof: proven ? "zk" : null });
  } catch (err) {
    if (err instanceof ClaimError) {
      return NextResponse.json({ ok: false, code: err.code, message: err.message }, { status: 400 });
    }
    throw err;
  }
}
