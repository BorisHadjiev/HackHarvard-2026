// Connects the Spectrum iMessage inbox when the portal boots. No reply is sent.
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { readPhotonConfig, startSpectrumInbox } = await import("@ntk/messaging");
  const config = readPhotonConfig();
  if (!config) {
    console.log("[photon] not configured; texts will be logged");
    return;
  }
  try {
    await startSpectrumInbox(config, async (phone, text) => {
      const { handleTenantText } = await import("./lib/text-reply");
      const payload = {
        type: "message.received",
        data: {
          object: {
            content: { type: "text", text },
            sentBy: { handle: phone, kind: "user" },
          },
        },
      };
      const result = await handleTenantText(payload, process.env.PORTAL_ORIGIN?.trim() || "http://localhost:3000");
      if (result.body.ignored) return;
      console.log(`[photon] inbound from ${phone} -> ${result.status}`);
    });
    console.log("[photon] iMessage connected");
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.log(`[photon] iMessage connect failed (${message})`);
  }
}
