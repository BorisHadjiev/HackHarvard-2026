import { NextResponse } from "next/server";
import { createLinkToken, plaidConfig, PlaidError } from "@/lib/plaid";

// Opens Plaid Link in the tenant's browser. Without keys, the consent screen hides the button.
export async function POST() {
  if (!plaidConfig().configured) return NextResponse.json({ configured: false });
  try {
    return NextResponse.json({ configured: true, linkToken: await createLinkToken() });
  } catch (err) {
    const e = err as PlaidError;
    return NextResponse.json({ configured: true, error: e.message, code: e.code }, { status: 502 });
  }
}
