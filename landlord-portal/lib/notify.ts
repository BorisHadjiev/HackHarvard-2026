// Sends the request to the tenant. Owner: Boris.
// Signature stays put so the API route doesn't change. Photon lives in @ntk/messaging;
// without PHOTON_API_KEY / PHOTON_PROJECT_ID / PHOTON_SENDER_ID this logs and returns "logged".
import { deliverTenantLink } from "@ntk/messaging";

export async function notifyTenant(phone: string | undefined, link: string, summary: string): Promise<"sent" | "logged"> {
  return deliverTenantLink(phone, link, summary);
}
