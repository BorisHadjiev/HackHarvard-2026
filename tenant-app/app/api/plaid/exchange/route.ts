import { NextResponse } from "next/server";
import { exchangePublicToken, PlaidError } from "@/lib/plaid";

// Plaid Link finished: keep the access token in this app's memory and give the browser a random id.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { publicToken?: string; institution?: string };
  if (!body.publicToken) return NextResponse.json({ error: "publicToken is required" }, { status: 400 });
  try {
    const linkId = await exchangePublicToken(body.publicToken, body.institution);
    return NextResponse.json({ linkId, institution: body.institution ?? null });
  } catch (err) {
    const e = err as PlaidError;
    return NextResponse.json({ error: e.message, code: e.code }, { status: 502 });
  }
}
