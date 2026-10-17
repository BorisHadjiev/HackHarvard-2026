# messaging/ (Boris)

Photon 2.0 client that texts the tenant their request link (Photon challenge: the project must be built on
Photon 2.0 and live on at least one Photon channel).

Guidelines and docs: https://somethingreat.notion.site/Hackathon-Guidelines-for-Photon-2-0-3f8e443f36bb81f9893fed0d08a4c01d

Plan:
1. Get a Photon number and API key; put them in `landlord-portal/.env.local` (never commit them).
2. Write the Photon client here (e.g. `messaging/photon.ts`) exporting `sendText(phone, body)`.
3. Call it from `notifyTenant()` in `landlord-portal/lib/notify.ts`. Keep that function's signature and
   keep the console.log fallback when Photon isn't configured, so the rest of the team can still run the app.
4. Stretch: the tenant replies YES to approve. The handler would call the tenant app's `/api/approve`.
5. The README at the repo root must say where Photon is used (judges check).
