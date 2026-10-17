# messaging/ (Boris)

Photon 2.0 client that texts the tenant their request link (Photon challenge: the project must be built on
Photon 2.0 and live on at least one Photon channel).

Guidelines and docs: https://somethingreat.notion.site/Hackathon-Guidelines-for-Photon-2-0-3f8e443f36bb81f9893fed0d08a4c01d

The client lives in `src/photon.ts` (`@ntk/messaging`). `sendText(phone, body, config)` uses the
Photon 2.0 TypeScript SDK (`@photon-ai/api`, beta API):

1. `createOrGetUser` for the tenant's phone on the configured platform (default `sms`).
2. `createOrGetSpace` between that user and `PHOTON_SENDER_ID`.
3. `sendMessage` with plain text.

`deliverTenantLink` is what `notifyTenant()` calls. If `PHOTON_API_KEY`, `PHOTON_PROJECT_ID`, or
`PHOTON_SENDER_ID` is missing, or the send throws, it keeps the console.log fallback so the rest of
the team can run the app.

Put the keys in `landlord-portal/.env.local` (never commit them):

```
PHOTON_API_KEY=pho_sk_...
PHOTON_PROJECT_ID=pho_prj_...
PHOTON_SENDER_ID=pho_usr_...
PHOTON_PLATFORM=sms
```

The repo root README has a "Where Photon is used" section for judges.

A reply of YES is handled by `parseYesReply` / `handleInboundYes` and `POST /api/photon/inbound` on the portal, which calls the tenant app's `/api/approve`. The phone-to-request map is process-local and is never written onto the request or the claim.
