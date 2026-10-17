// Photon 2.0 client (beta API, https://api.photon.codes/v1).
// Texts the tenant a request link. Owner: Boris.
import { randomUUID } from "node:crypto";

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

/** Beta Photon API projects use `pho_prj_` ids. Spectrum Cloud projects do not. */
export function usesBetaPhotonApi(config: PhotonConfig): boolean {
  return config.projectId.startsWith("pho_prj_");
}

function scrubSecret(err: unknown, secret: string): Error {
  const message = err instanceof Error ? err.message : "unknown error";
  return new Error(secret ? message.split(secret).join("[redacted]") : message);
}

type SpectrumTextMessage = {
  id: string;
  platform: string;
  direction: "inbound" | "outbound";
  content: { type: string; text?: string };
  sender?: { id: string; address?: string };
};

type SpectrumSpace = {
  id: string;
  send: (content: string) => Promise<{ id: string } | undefined>;
};

type SpectrumSession = {
  messages: AsyncIterable<[unknown, SpectrumTextMessage]>;
  openDm: (handle: string) => Promise<SpectrumSpace>;
};

const spectrumGlobals = globalThis as unknown as {
  __ntkSpectrumSessions?: Map<string, Promise<SpectrumSession>>;
  __ntkSpectrumSpaces?: Map<string, SpectrumSpace>;
  __ntkSpectrumInbox?: boolean;
};
const spectrumSessions = (spectrumGlobals.__ntkSpectrumSessions ??= new Map());
const spectrumSpaces = (spectrumGlobals.__ntkSpectrumSpaces ??= new Map());

async function spectrumSession(config: PhotonConfig): Promise<SpectrumSession> {
  const cached = spectrumSessions.get(config.projectId);
  if (cached) return cached;
  const pending = (async () => {
    const { Spectrum } = await import("@spectrum-ts/core");
    const { imessage } = await import("@spectrum-ts/imessage");
    const app = await Spectrum({
      projectId: config.projectId,
      projectSecret: config.apiKey,
      providers: [imessage.config()],
      options: { logLevel: "info" },
    });
    const im = imessage(app);
    return {
      messages: app.messages as AsyncIterable<[unknown, SpectrumTextMessage]>,
      async openDm(handle: string) {
        const space = await im.space.create(handle);
        return space as SpectrumSpace;
      },
    };
  })();
  spectrumSessions.set(config.projectId, pending);
  try {
    return await pending;
  } catch (err) {
    spectrumSessions.delete(config.projectId);
    throw scrubSecret(err, config.apiKey);
  }
}

function tenantHandle(participantIds: string[]): string {
  const handle = participantIds.find((id) => id.startsWith("+"));
  if (!handle) throw new Error("Spectrum iMessage send needs the tenant phone");
  return handle;
}

function createSpectrumClient(config: PhotonConfig): PhotonMessagingClient {
  if (config.platform !== "imessage") {
    throw new Error("This Photon project is Spectrum iMessage; set PHOTON_PLATFORM=imessage");
  }
  return {
    async createOrGetUser(handle) {
      if (spectrumSpaces.has(handle)) return { id: handle };
      try {
        const session = await spectrumSession(config);
        const space = await session.openDm(handle);
        spectrumSpaces.set(handle, space);
        spectrumSpaces.set(space.id, space);
        return { id: handle };
      } catch (err) {
        throw scrubSecret(err, config.apiKey);
      }
    },
    async createOrGetSpace(participantIds, platform) {
      if (platform !== "imessage") throw new Error("Spectrum setup is iMessage only");
      const handle = tenantHandle(participantIds);
      const existing = spectrumSpaces.get(handle);
      if (existing) return { id: existing.id };
      try {
        const session = await spectrumSession(config);
        const space = await session.openDm(handle);
        spectrumSpaces.set(handle, space);
        spectrumSpaces.set(space.id, space);
        return { id: space.id };
      } catch (err) {
        throw scrubSecret(err, config.apiKey);
      }
    },
    async sendMessage({ spaceId, text }) {
      const space = spectrumSpaces.get(spaceId) ?? [...spectrumSpaces.values()].find((item) => item.id === spaceId);
      if (!space) throw new Error("Spectrum space was not opened in this process");
      try {
        const sent = await space.send(text);
        return { id: sent?.id || randomUUID() };
      } catch (err) {
        throw scrubSecret(err, config.apiKey);
      }
    },
  };
}

/**
 * Listen for inbound iMessage on a Spectrum project. Does not reply.
 * Beta `pho_prj_` projects keep the webhook at POST /api/photon/inbound.
 */
export async function startSpectrumInbox(
  config: PhotonConfig,
  onText: (phone: string, text: string) => Promise<void>,
): Promise<void> {
  if (usesBetaPhotonApi(config) || config.platform !== "imessage") return;
  if (spectrumGlobals.__ntkSpectrumInbox) return;
  spectrumGlobals.__ntkSpectrumInbox = true;
  let session: SpectrumSession;
  try {
    session = await spectrumSession(config);
  } catch (err) {
    spectrumGlobals.__ntkSpectrumInbox = false;
    throw scrubSecret(err, config.apiKey);
  }
  void (async () => {
    for await (const [, message] of session.messages) {
      if (message.platform !== "imessage" || message.direction !== "inbound") continue;
      if (message.content?.type !== "text" || typeof message.content.text !== "string") continue;
      const phone = message.sender?.address || message.sender?.id;
      if (!phone) continue;
      try {
        await onText(phone, message.content.text);
      } catch (err) {
        console.log(`[photon] inbound handler failed (${scrubSecret(err, config.apiKey).message})`);
      }
    }
  })().catch((err) => {
    console.log(`[photon] inbox stopped (${scrubSecret(err, config.apiKey).message})`);
  });
}

function createBetaClient(config: PhotonConfig): PhotonMessagingClient {
  // Loaded on use. A static import breaks portal tests, which run as CommonJS.
  const client = import("@photon-ai/api").then(
    ({ Photon }) => new Photon({ headers: { Authorization: `Bearer ${config.apiKey}` } }),
  );
  return {
    async createOrGetUser(handle, platform) {
      const user = await (await client).projects.createOrGetUser({
        path: { id: config.projectId },
        body: { handle, platform },
      });
      return { id: resourceId(user, "user") };
    },
    async createOrGetSpace(participantIds, platform, idempotencyKey) {
      const space = await (await client).projects.createOrGetSpace({
        path: { id: config.projectId },
        headers: { "idempotency-key": idempotencyKey },
        body: { participantIds, platform },
      });
      return { id: resourceId(space, "space") };
    },
    async sendMessage({ spaceId, senderId, text, idempotencyKey }) {
      const sent = await (await client).projects.sendMessage({
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

export function createPhotonClient(config: PhotonConfig): PhotonMessagingClient {
  if (usesBetaPhotonApi(config)) return createBetaClient(config);
  return createSpectrumClient(config);
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
