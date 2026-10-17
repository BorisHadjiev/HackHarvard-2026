import { NextResponse } from "next/server";
import { store, publicView } from "@/lib/store";

// The tenant app calls this to show the consent screen.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const request = store.requests.get(id);
  if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  return NextResponse.json({ request: publicView(request), result: request.result ?? null });
}
