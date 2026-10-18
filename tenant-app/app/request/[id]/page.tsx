// Consent screen (server part): loads the request from the landlord portal.
import { EVIDENCE_LABELS, type EvidenceStrength, type VerificationRequest } from "@ntk/shared";
import { tenantConfig } from "@/lib/config";
import { DEMO_TENANTS } from "@/lib/nessie";
import { plaidConfig } from "@/lib/plaid";
import Consent from "./consent";

export const dynamic = "force-dynamic";

function evidenceLabel(value: unknown): string | null {
  if (value === "bank" || value === "document_signed" || value === "document_bank_matched" || value === "document_unverified") {
    return EVIDENCE_LABELS[value as EvidenceStrength];
  }
  return null;
}

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
        <p><a href="/">Back to Janus</a></p>
      </main>
    );
  }
  if (res.status === 404) {
    return (
      <main>
        <h1>This link doesn&apos;t match an open request</h1>
        <p className="sub">It may be mistyped, or the request was never created. Ask the landlord for a new link.</p>
        <p><a href="/">Back to Janus</a></p>
      </main>
    );
  }
  if (!res.ok) {
    return (
      <main>
        <h1>This request didn&apos;t load</h1>
        <p className="sub">The landlord portal returned an error. Refresh this page, or ask them to send a new link.</p>
        <p><a href="/">Back to Janus</a></p>
      </main>
    );
  }
  const body = (await res.json()) as { request: VerificationRequest; result?: { answer?: boolean; evidence?: string } | null };
  const request = body.request;
  // The public payload's result is only a yes/no plus a coarse evidence label.
  const recordedAnswer = body.result?.answer === true ? true : body.result?.answer === false ? false : null;
  const recordedEvidence = evidenceLabel(body.result?.evidence);
  const age = request.question.type === "age_over";

  return (
    <main className="tenant-page">
      <p className="kicker">{request.requesterName}</p>
      {age ? (
        <>
          <h1>Prove you&apos;re 18 or older</h1>
          <p className="sub">The landlord learns only yes or no. Your date of birth, name and ID number stay on this device.</p>
        </>
      ) : (
        <>
          <h1>A little certainty.<br />Your privacy, intact.</h1>
          <p className="sub">Review the request below. Upload a document on this device, or use bank data. Only a yes or no can be shared.</p>
        </>
      )}
      <Consent request={request} portal={portalUrl} tenants={DEMO_TENANTS} recordedAnswer={recordedAnswer} recordedEvidence={recordedEvidence} plaidConfigured={plaidConfig().configured} />
    </main>
  );
}
