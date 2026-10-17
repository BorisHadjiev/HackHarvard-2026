import { NextResponse } from "next/server";
import { analyzeDocuments } from "@/lib/documents/analyze";
import { summarizeDecision } from "@/lib/documents/summary";
import { getBankDeposits, parseBankChoice } from "@/lib/bank";
import { readEvidenceRequest } from "@/lib/request-body";

// Check documents on this device and show the tenant what was found. Nothing is sent to the landlord.
export async function POST(req: Request) {
  const body = await readEvidenceRequest(req);
  if (!body.files.length) return NextResponse.json({ error: "Add at least one document" }, { status: 400 });
  const rent = Number(body.rent);
  const multiple = Number(body.multiple ?? 3);
  if (!(rent > 0) || !(multiple > 0)) return NextResponse.json({ error: "rent and multiple are required" }, { status: 400 });

  let bank;
  let bankError: string | undefined;
  if (body.confirmWithBank) {
    try {
      bank = await getBankDeposits(parseBankChoice(body.tenant, body.plaidLinkId));
    } catch (err) {
      bankError = (err as Error).message;
    }
  }
  const decision = await analyzeDocuments(body.files, { bank, rent, multiple });
  return NextResponse.json({ ...summarizeDecision(decision), bankSource: bank?.source ?? null, bankError: bankError ?? null });
}
