// Consent screen (server part): loads the request from the landlord portal.
import type { VerificationRequest } from "@ntk/shared";
import { tenantConfig } from "@/lib/config";
import { DEMO_TENANTS } from "@/lib/nessie";
import Consent from "./consent";

export const dynamic = "force-dynamic";

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ portal?: string }>;
}) {
  const { id } = await params;
  const { portal } = await searchParams;
  const portalUrl = portal || tenantConfig().defaultPortalUrl;

  const res = await fetch(`${portalUrl}/api/requests/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!res.ok) {
    return (
      <main>
        <header className="top">
          <span className="mark">Need-to-Know</span>
          <span className="role">Tenant</span>
        </header>
        <h1>This link doesn&apos;t match a request.</h1>
        <p className="sub">Ask the landlord to send a new one. Nothing was read from a bank account.</p>
      </main>
    );
  }
  const { request, result } = (await res.json()) as { request: VerificationRequest; result: { answer: boolean } | null };

  return (
    <main>
      <header className="top">
        <span className="mark">Need-to-Know</span>
        <span className="role">Tenant</span>
      </header>
      <h1>{request.requesterName} has a question</h1>
      <p className="sub">Answered on this device. Your bank data stays here.</p>
      <Consent request={request} portal={portalUrl} tenants={DEMO_TENANTS} verdict={result} />
    </main>
  );
}
