// Consent screen (server part): loads the request from the landlord portal.
import type { VerificationRequest } from "@ntk/shared";
import { tenantConfig } from "@/lib/config";
import { DEMO_TENANTS } from "@/lib/nessie";
import { plaidConfig } from "@/lib/plaid";
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

  let res: Response;
  try {
    res = await fetch(`${portalUrl}/api/requests/${encodeURIComponent(id)}`, { cache: "no-store" });
  } catch {
    return (
      <main>
        <h1>Can&apos;t reach the landlord</h1>
        <p className="sub">The portal that sent this link is not responding. Ask them to send it again once their portal is open.</p>
        <p><a href="/">Back to Need-to-Know</a></p>
      </main>
    );
  }
  if (res.status === 404) {
    return (
      <main>
        <h1>This link doesn&apos;t match an open request</h1>
        <p className="sub">It may be mistyped, or the request was never created. Ask the landlord for a new link.</p>
        <p><a href="/">Back to Need-to-Know</a></p>
      </main>
    );
  }
  if (!res.ok) {
    return (
      <main>
        <h1>This request didn&apos;t load</h1>
        <p className="sub">The landlord portal returned an error. Refresh this page, or ask them to send a new link.</p>
        <p><a href="/">Back to Need-to-Know</a></p>
      </main>
    );
  }
  const body = (await res.json()) as { request: VerificationRequest; result?: { answer?: boolean } | null };
  const request = body.request;
  // The public payload's result is only a yes/no. Dollar amounts are not on this response.
  const recordedAnswer = body.result?.answer === true ? true : body.result?.answer === false ? false : null;

  return (
    <main className="tenant-page">
      <p className="kicker">{request.requesterName}</p>
      <h1>A little certainty.<br />Your privacy, intact.</h1>
      <p className="sub">Review the request below. Upload a document on this device, or use bank data. Only a yes or no can be shared.</p>
      <Consent request={request} portal={portalUrl} tenants={DEMO_TENANTS} recordedAnswer={recordedAnswer} plaidConfigured={plaidConfig().configured} />
    </main>
  );
}
