// Photon 2.0 client (beta API, https://api.photon.codes/v1).
// Texts the tenant a request link. Owner: Boris.
import { randomUUID } from "node:crypto";
import { Photon } from "@photon-ai/api";

export const PHOTON_PLATFORMS = ["sms", "imessage", "whatsapp", "whatsapp_business", "telegram", "email"] as const;
export type PhotonPlatform = (typeof PHOTON_PLATFORMS)[number];

/** Keys live in landlord-portal/.env.local. Missing any of the three means "not configured". */
export interface PhotonConfig {
  apiKey: string;
  projectId: string;
  /** Agent user id (pho_usr_...) that sends the text. */
  senderId: string;
  platform: PhotonPlatform;
}

export interface PhotonMessagingClient {
  createOrGetUser(handle: string, platform: PhotonPlatform): Promise<{ id: string }>;
  createOrGetSpace(participantIds: string[], platform: PhotonPlatform, idempotencyKey: string): Promise<{ id: string }>;
  sendMessage(args: { spaceId: string; senderId: string; text: string; idempotencyKey: string }): Promise<{ id: string }>;
}

export function readPhotonConfig(env: NodeJS.ProcessEnv = process.env): PhotonConfig | null {
  const apiKey = env.PHOTON_API_KEY?.trim();
  const projectId = env.PHOTON_PROJECT_ID?.trim();
  const senderId = env.PHOTON_SENDER_ID?.trim();
  if (!apiKey || !projectId || !senderId) return null;
  const raw = env.PHOTON_PLATFORM?.trim() || "sms";
  if (!PHOTON_PLATFORMS.includes(raw as PhotonPlatform)) {
    throw new Error(`PHOTON_PLATFORM must be one of ${PHOTON_PLATFORMS.join(", ")}`);
  }
  return { apiKey, projectId, senderId, platform: raw as PhotonPlatform };
}

/** US-friendly phone cleanup. Photon matches SMS users on the handle we send. */
export function normalizePhone(input: string): string {
  const compact = input.trim().replace(/[^\d+]/g, "");
  const digits = compact.replace(/\D/g, "");
  if (!digits) throw new Error("Phone number is empty");
  if (compact.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function resourceId(resource: unknown, label: string): string {
  if (typeof resource !== "object" || resource === null || !("id" in resource) || typeof resource.id !== "string" || resource.id.length === 0) {
    throw new Error(`Photon ${label} response did not include an id`);
  }
  return resource.id;
}

export function createPhotonClient(config: PhotonConfig): PhotonMessagingClient {
  const photon = new Photon({ headers: { Authorization: `Bearer ${config.apiKey}` } });
  return {
    async createOrGetUser(handle, platform) {
      const user = await photon.projects.createOrGetUser({
        path: { id: config.projectId },
        body: { handle, platform },
      });
      return { id: resourceId(user, "user") };
    },
    async createOrGetSpace(participantIds, platform, idempotencyKey) {
      const space = await photon.projects.createOrGetSpace({
        path: { id: config.projectId },
        headers: { "idempotency-key": idempotencyKey },
        body: { participantIds, platform },
      });
      return { id: resourceId(space, "space") };
    },
    async sendMessage({ spaceId, senderId, text, idempotencyKey }) {
      const sent = await photon.projects.sendMessage({
        path: { id: config.projectId },
        headers: { "idempotency-key": idempotencyKey },
        body: {
          spaceId,
          senderId,
          content: { type: "text", format: "plain", text },
        },
      });
      return { id: resourceId(sent, "message") };
    },
  };
}

/**
 * Text `body` to `phone` from the configured Photon sender.
 * Resolves the recipient, opens a direct space, then sends one plain-text message.
 */
export async function sendText(
  phone: string,
  body: string,
  config: PhotonConfig,
  client: PhotonMessagingClient = createPhotonClient(config),
): Promise<{ messageId: string }> {
  const handle = normalizePhone(phone);
  const user = await client.createOrGetUser(handle, config.platform);
  const space = await client.createOrGetSpace(
    [config.senderId, user.id],
    config.platform,
    `ntk-space:${config.platform}:${config.senderId}:${user.id}`,
  );
  const sent = await client.sendMessage({
    spaceId: space.id,
    senderId: config.senderId,
    text: body,
    idempotencyKey: randomUUID(),
  });
  return { messageId: sent.id };
}
