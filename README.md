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
- ⏳ Real Nessie data (Angelo) · ⏳ real tamper check (Sam) · ⏳ Photon texts + design (Boris)

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

`npm test` runs the unit tests (signing + income logic).

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

1. Run it (above) and read `shared/src/claims.ts` and `shared/test/claims.test.ts` (signing already works; review it).
2. Build the real tamper check (`tenant-app/lib/integrity.ts` has the plan): a `scripts/sign-manifest.ts` that hashes the tenant-app source and signs it with a separate release key; `checkIntegrity()` recomputes the hash and verifies the manifest. Put the approved hash in `TRUSTED_BUILD_HASHES` in `landlord-portal/.env.local`.
3. Demo test: edit one line in `tenant-app/lib/income.ts` → Approve must fail with "refusing to sign".
4. Replace the in-memory store in `landlord-portal/lib/store.ts` with a JSON file or SQLite so requests survive a restart.

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
- Everything else in the claim must be the same for every tenant or too coarse to link: one shared app signing key (never per-tenant), timestamps rounded to the hour, no IP/device data stored by the portal.
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
| `scripts/` | `gen-keys`, `smoke-test`, `seed-nessie`, (soon) `sign-manifest` | All |
| `docs/` | Threat model, pitch notes | Angelo |

## Rules

- **Never commit secrets.** Keys live in `*/.env.local` (git-ignored). Share API keys in the group chat.
- **Never hand-roll crypto.** Everything goes through `jose`.
- **The signed claim never contains dollar amounts or documents.** `npm run smoke` checks this.
- **`shared/` changes:** announce in the group chat. Both apps import it.
- **6:00 PM:** tag `demo-stable`. If anything breaks later, demo from that tag.
