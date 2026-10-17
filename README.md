# Need-to-Know

[![CI](https://github.com/BorisHadjiev/HackHarvard-2026/actions/workflows/ci.yml/badge.svg)](https://github.com/BorisHadjiev/HackHarvard-2026/actions/workflows/ci.yml) Every push and PR runs unit tests, builds both apps and runs the end-to-end smoke test (plus the collusion test once it exists). Don't merge a red PR.

**Prove one fact about yourself (income ≥ 3× rent, age ≥ 18) without handing over a single document.**
HackHarvard 2026 · Digital Trust track · Capital One Nessie + Photon challenges.

A landlord asks one question. The tenant's own computer pulls their bank deposits, computes the answer locally, and sends back only a signed yes or no. The landlord sees ✓ or ✗, never balances, statements or IDs.

> **Deadline: Devpost submission by 7:45 AM Sunday Oct 18 (hard deadline 8:00 AM).** MVP freeze and `demo-stable` tag at **6:00 PM Saturday**.

---

## Status: the skeleton already works end to end

`npm run smoke` passes today against fake bank data:

- ✅ Landlord creates a request with a one-time code
- ✅ Tenant opens the consent screen and approves
- ✅ Tenant app computes income locally and signs a claim with **no dollar amounts**
- ✅ Landlord portal verifies the signature and shows ✓ / ✗
- ✅ Answering the same request twice is rejected (replay)
- ✅ Leo's one-time $6,000 transfer doesn't fool the income check
- ✅ Tamper check: editing the tenant app's code makes it refuse to sign (Sam)
- ✅ Requests and used one-time codes survive a portal restart (Sam)
- ✅ Photon texts, console fallback, and both screens (Boris)
- ✅ Income documents read on the tenant's device: pay stubs, bank statements, W-2s, 1040s, PDF or photo (Sam)
- ✅ Plaid bank connection in sandbox, once `PLAID_CLIENT_ID` and `PLAID_SECRET` are set (Sam)
- ⏳ Real Nessie data (Angelo)

Every placeholder in the code is marked `TODO(Angelo)`, `TODO(Sam)` or `TODO(Boris)`. Search for your name.

---

## Run it (everyone, ~3 minutes)

Needs Node 20+.

```bash
git clone https://github.com/BorisHadjiev/HackHarvard-2026.git
cd HackHarvard-2026
npm run setup        # installs everything + generates signing keys into .env.local files
npm run dev          # landlord portal on :3000, tenant app on :3001
```

Then, in a second terminal: `npm run smoke` (should print 6 PASS lines). Or by hand:

1. Open http://localhost:3000, click **Send verification request**.
2. Open the **Tenant link** it shows, pick a demo bank account, click **Approve**.
3. Back on :3000 the request flips to ✓ or ✗ within 2 seconds.

`npm test` runs the unit tests (signing, income logic, tamper check, portal storage, and the Photon client).

## Zero-knowledge proof: the yes/no can't be faked

For bank-backed answers the tenant's device doesn't just *say* yes or no. It proves it.

1. **The bank signs the data.** The tenant app asks the bank for the deposit list. The bank returns it together with a signature over a commitment (a hash) of that exact list, salted per request. For the hackathon a stand-in bank service (`bank-signer/`, port 3002) plays this role with its own key, which the tenant app never holds. In production this is the bank or an open-banking provider.
2. **The device proves the rule.** A Noir circuit (`zk/circuit/src/main.nr`) takes the deposits as private inputs and proves "median monthly recurring income ≥ multiple × rent" for the list behind that commitment, bound to the landlord's rent, multiple and one-time code. Proving takes about a second on a laptop.
3. **The landlord verifies both.** The portal checks the bank's signature (`TRUSTED_BANK_KEYS`) and the proof, and that the proof's answer matches the signed claim. It never sees a deposit, only a hash it can't invert and a proof it can't forge.

What this stops: a tenant who edits the app to always say yes, invents deposits, replays a proof from another request, or flips the answer. What it doesn't stop: a bank that signs false data, or a device compromised below the app. Without a bank connection (documents, or Plaid until it signs data) the answer carries no proof, and the landlord sees that.

When `TRUSTED_BANK_KEYS` is set, the portal rejects any bank-backed answer that arrives without a proof. `npm run keys` sets it up locally. Circuit changes: edit `main.nr`, then `npm run compile:zk`.

## Age check (18+)

A landlord can also ask "are you at least 18?". The tenant uploads a photo or PDF of a government ID and the tenant app reads the date of birth on the tenant's own machine:

1. **Driver's license or state ID:** the PDF417 barcode on the back (AAMVA format), decoded with `zxing-wasm` loaded from `node_modules`. Machine data, no guessing.
2. **Passport or ID card:** the machine-readable zone, read by OCR and verified with the ICAO 9303 check digits. A hand-edited digit breaks a check digit, and the ID is declined with that reason.
3. **Front of the card:** "DOB" / "Date of Birth" followed by a date, as a fallback.

The checks the tenant sees: date of birth found, plausible, not expired, check digits match, barcode agrees with the front. The date of birth itself is never shown, logged, or sent anywhere, not even to the tenant's own browser. The landlord gets a signed yes or no. An ID that is under 18 gives a signed no; an unreadable, expired or failed ID signs nothing and the landlord sees "declined".

Every age claim is labeled "documents only, not independently verified": a photo of an ID can be forged and nothing on a laptop can prove it came from a real issuer. The production version reads a state-signed mobile driver's license (ISO/IEC 18013-5) instead.

## Income documents and bank apps

The tenant can prove income from **bank data** (demo account, Nessie, or a real banking app through Plaid) or from **income documents**. Documents are read on the tenant's machine, checked, and never uploaded. The landlord sees the answer plus how strongly it was backed:

| Evidence level | When |
|---|---|
| Bank-verified | Computed from deposits pulled straight from the bank |
| Signed documents | Every document used carries a valid digital signature from a trusted issuer |
| Documents confirmed by bank | Every document used matches the bank's own records |
| Documents only, not independently verified | Documents passed the on-device checks, but nothing independent confirmed them |

A scan or photo alone can be edited, so documents need the bank or a signature to count as verified. Each document is checked for:
- **Its own arithmetic.** Gross minus deductions equals net, statement balances add up, W-2 payroll taxes are 6.2% and 1.45%, and 1040 AGI is total income minus adjustments.
- **Signs of editing.** The app looks at editing-tool metadata and saves made after creation, and checks that any digital signature is intact.
- **The bank's records.** Net pay must actually arrive, and statement deposits must match.
- **Freshness.** Pay stubs and statements must be recent, and tax forms must be from a recent finished tax year.

Try it:

```bash
npm run sample-docs
```

That writes demo documents to `sample-documents/` that line up with today's demo bank data. It includes a signed pay stub and two forged ones, and `sample-documents/README.txt` says what each should do. On the consent screen, choose **Income documents**, add files, and click **Check documents first**.

For a real banking app, add Plaid sandbox keys to `tenant-app/.env.local` and restart. The consent screen then shows **Connect your bank (Plaid)**, and the sandbox test login is `user_good` / `pass_good`:

```
PLAID_CLIENT_ID=...
PLAID_SECRET=...
```

Accuracy on a labeled synthetic corpus, including photos and forgeries, is in [docs/document-accuracy.md](docs/document-accuracy.md). Regenerate it with `npm run doc-accuracy`.

## Where Photon is used

Judges check that the project is built on Photon 2.0 and lives on a Photon channel. The text to the tenant is that channel.

- **Client:** `messaging/` (`@ntk/messaging`) uses the Photon 2.0 TypeScript SDK (`@photon-ai/api`) against `https://api.photon.codes/v1`. `sendText` creates or reuses the tenant user, opens a space with the agent, and sends one plain-text message.
- **Call site:** `notifyTenant()` in `landlord-portal/lib/notify.ts`, called from `POST /api/requests` when the landlord enters a phone number. The text is the question summary plus the tenant link.
- **Channel:** `PHOTON_PLATFORM` in `landlord-portal/.env.local` (default `sms`). Also set `PHOTON_API_KEY`, `PHOTON_PROJECT_ID`, and `PHOTON_SENDER_ID` (the agent user id). Never commit that file.
- **Fallback:** if those three keys are missing, or Photon returns an error, the portal logs the link and still shows it on screen. `delivery` in the create response is `"sent"` or `"logged"`.
- **Reply YES:** `POST /api/photon/inbound` accepts a Photon `message.received` event. A plain-text `YES` from the phone on the latest request approves it through the tenant app (demo account `PHOTON_YES_TENANT`, default `maya`). The phone number is remembered only in memory for that reply. It is not stored on the request or inside the signed claim. Set `PHOTON_INBOUND_SECRET` and send it as `x-ntk-inbound-secret` before exposing the portal. The portal's reply drops the tenant-only income figure.

---

## First steps for each person

Work on your own branch, merge to `main` at least every 2 hours, and keep `main` running.
Before you start, point your AI tool at **`AGENTS.md`**. It has the architecture, the claim format and the rules, so every assistant builds the same thing.

### Angelo: bank data + income logic + pitch (using Codex)

Branch: `angelo/nessie`

1. Run it (above) and confirm `npm run smoke` passes.
2. Get a Nessie API key at http://api.nessieisreal.com and add `NESSIE_API_KEY=...` to `tenant-app/.env.local`.
3. Check `scripts/seed-nessie.ts` against the Nessie docs (it's a draft), then run it:
   `NESSIE_API_KEY=... npx tsx scripts/seed-nessie.ts` and paste the two printed `NESSIE_ACCOUNT_...` lines into `tenant-app/.env.local`.
4. Confirm the field mapping in `tenant-app/lib/nessie.ts` matches what Nessie returns. The consent screen's "Only you see this" line should now say `source: nessie`.
5. Refine the rule in `tenant-app/lib/income.ts` and add tests to `tenant-app/test/income.test.ts`.
6. Then: threat model (`docs/threat-model.md`), pitch deck, Devpost draft by 11 PM.

Starter prompt for Codex:
> Read AGENTS.md. Open tenant-app/lib/nessie.ts and scripts/seed-nessie.ts. Check every Nessie endpoint and field name against the Nessie API docs, fix any mismatch, and keep the function signatures the same. Don't touch shared/ or the UI.

### Sam: security + signing (using Claude)

Branch: `sam/tamper-check`

Done: real tamper check, persistent portal store, `iat` rounded down to the UTC day for the collusion test.

**Tamper check (turn it on for the demo):**

1. `npm run sign-manifest`. It hashes `tenant-app/app`, `tenant-app/lib` and `shared/src`, signs the hash with a separate release key (`.keys/`, git-ignored), writes `tenant-app/build-manifest.json`, and puts the approved hash in `TRUSTED_BUILD_HASHES` on the portal.
2. Demo: edit one line in `tenant-app/lib/income.ts`, click Approve. It fails with "App code was modified (tenant-app/lib/income.ts); refusing to sign".
3. If someone also disables the local check, the portal still rejects the claim as `untrusted_build`.
4. Re-run `npm run sign-manifest` after every code change, or Approve keeps refusing. `npm run sign-manifest -- --reset` turns it back off.

Without a manifest (everyone's default), the app runs as an unsigned dev build and the portal accepts it, so nobody's dev loop breaks.

**Portal store:** requests and used one-time codes are saved to `landlord-portal/.data/store.json` (git-ignored), so a restart doesn't lose them or allow a replay.

Starter prompt for Claude (Claude Code in the repo folder, or paste the files into claude.ai):
> Read CLAUDE.md and AGENTS.md. Implement the tamper check described in tenant-app/lib/integrity.ts using only `jose` and node:crypto. Add scripts/sign-manifest.ts and tests. Don't change ClaimPayload in shared/src/types.ts without telling me.

### Boris: frontend + messaging (using Cursor)

Branch: `boris/photon`

1. Run it (above) and click through both screens.
2. Set up Photon 2.0 (guidelines: https://somethingreat.notion.site/Hackathon-Guidelines-for-Photon-2-0-3f8e443f36bb81f9893fed0d08a4c01d) and get a number.
3. Build the Photon client in `messaging/` (see `messaging/README.md`) and call it from `notifyTenant()` in `landlord-portal/lib/notify.ts`. Keep that function's signature. Check: entering your phone on :3000 sends you the tenant link by text.
4. Design pass on `landlord-portal/app/page.tsx` and `tenant-app/app/request/[id]/consent.tsx`. Placeholder CSS is in each app's `app/globals.css`.
5. Stretch: approve by replying YES to the text.

Starter prompt for Cursor:
> @AGENTS.md Implement notifyTenant in landlord-portal/lib/notify.ts using the Photon 2.0 SDK so it texts the tenant link to the phone number. Keep the function signature and fall back to console.log if Photon isn't configured. Read the key from landlord-portal/.env.local.

---

## Next, right after the MVP: collusion test (unlinkability)

**"Even if every website compares notes, they can't track you."**
The same tenant proves the income fact to two different landlords. The landlords pool everything they received and try to tell whether it was the same person, and fail.

- Each landlord already gets a different pairwise ID (`sub`) for the same tenant.
- Everything else in the claim must be the same for every tenant or too coarse to link: one shared app signing key (never per-tenant), timestamps rounded down to the UTC day, no IP/device data stored by the portal.
- Build `scripts/collusion-test.ts`: two portal audiences, two tenants, each answers both; pool the 4 claims and show matching them back to tenants is no better than a coin flip. Boris builds a side-by-side demo screen; Angelo makes the slide.

---

## How it's built

```
landlord-portal (:3000)                tenant app (:3001, the tenant's own machine)
  POST /api/requests  ── text/link ──▶   /request/[id]   consent screen
  GET  /api/requests/[id] ◀───────────   POST /api/approve
                                           1. tamper check        (Sam)
                                           2. fetch deposits      (Angelo, Nessie)
                                           3. income ≥ k × rent?  (Angelo)
                                           4. sign yes/no         (shared/)
  POST /api/claims ◀── signed yes/no ──    5. send ONLY the signed claim
  verify → ✓ / ✗
```

| Folder | What | Owner |
|---|---|---|
| `shared/` | Types (`VerificationRequest`, `ClaimPayload`), sign/verify with `jose` (Ed25519) | Sam |
| `tenant-app/` | Consent screen, Nessie fetch, income math, tamper check, signing | Angelo (data/math), Sam (integrity), Boris (UI) |
| `landlord-portal/` | Create requests, verify claims, show result | Boris (UI), Sam (storage) |
| `messaging/` | Photon 2.0 client | Boris |
| `scripts/` | `gen-keys`, `smoke-test`, `seed-nessie`, `sign-manifest` | All |
| `docs/` | Threat model, pitch notes | Angelo |

## Rules

- **Never commit secrets.** Keys live in `*/.env.local` (git-ignored). Share API keys in the group chat.
- **Never hand-roll crypto.** Everything goes through `jose`.
- **The signed claim never contains dollar amounts or documents.** `npm run smoke` checks this.
- **`shared/` changes:** announce in the group chat. Both apps import it.
- **6:00 PM:** tag `demo-stable`. If anything breaks later, demo from that tag.
