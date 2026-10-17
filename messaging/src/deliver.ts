// Decides whether a tenant notification is a Photon text or a console log.
// notifyTenant() in the landlord portal calls this and keeps its own signature.
import { readPhotonConfig, sendText, type PhotonConfig, type PhotonMessagingClient } from "./photon";

export interface DeliverDeps {
  env?: NodeJS.ProcessEnv;
  config?: PhotonConfig | null;
  send?: typeof sendText;
  client?: PhotonMessagingClient;
  log?: (line: string) => void;
}

/** Body of the text. The rent figure is the landlord's question, never the tenant's balance. */
export function tenantText(summary: string, link: string): string {
  return `${summary}\n${link}`;
}

export async function deliverTenantLink(
  phone: string | undefined,
  link: string,
  summary: string,
  deps: DeliverDeps = {},
): Promise<"sent" | "logged"> {
  const log = deps.log ?? console.log;
  const fallback = () => {
    log(`[notify] would text ${phone ?? "(no phone)"}: ${summary} -> ${link}`);
    return "logged" as const;
  };

  const config = deps.config !== undefined ? deps.config : readPhotonConfig(deps.env ?? process.env);
  if (!config || !phone?.trim()) return fallback();

  try {
    const send = deps.send ?? sendText;
    await send(phone, tenantText(summary, link), config, deps.client);
    log(`[notify] texted ${phone}: ${summary} -> ${link}`);
    return "sent";
  } catch (err) {
    log(`[notify] Photon send failed (${err instanceof Error ? err.message : "unknown error"}); falling back to log`);
    return fallback();
  }
}
