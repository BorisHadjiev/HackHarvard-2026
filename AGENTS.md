# AGENTS.md: context for every AI coding assistant on this repo

(Codex reads this file directly. Claude reads it via CLAUDE.md. Cursor reads it via .cursor/rules.)

## Product
Need-to-Know lets a tenant prove one fact ("income ≥ 3× rent") to a landlord without sharing documents.
The tenant app runs on the tenant's own machine, reads bank deposits (Capital One Nessie), computes the
answer locally and sends only a signed yes/no. Hackathon: HackHarvard 2026, submission due 8 AM Sun Oct 18.

## Architecture
- npm workspaces monorepo, TypeScript everywhere, Next.js 16 App Router, React 19.
- `shared/` (`@ntk/shared`): types + `signClaim` / `verifyClaim` / `pairwiseSubject` using `jose` (EdDSA / Ed25519).
  Imported as TypeScript source by both apps (`transpilePackages`). No build step.
- `landlord-portal/` (port 3000): `POST /api/requests` creates a request (id, one-time nonce, question);
  `GET /api/requests/[id]` returns the public view; `POST /api/claims` verifies a signed claim and
  rejects replays. In-memory store in `lib/store.ts`.
- `tenant-app/` (port 3001): `/request/[id]` consent screen; `POST /api/approve` runs
  integrity check → `fetchDeposits` (lib/nessie.ts) → `evaluateIncome` (lib/income.ts) → `signClaim` →
  posts the token to the portal.
- Tamper check (`tenant-app/lib/integrity.ts`, `lib/build-hash.ts`): hashes `tenant-app/app`, `tenant-app/lib`,
  `shared/src` and compares with `tenant-app/build-manifest.json`, signed by a separate release key
  (`npm run sign-manifest`, key in git-ignored `.keys/`). No manifest = unsigned dev build (hash `unsigned-dev-build`).
- Portal store (`landlord-portal/lib/store.ts`): JSON file `landlord-portal/.data/store.json`; Map/Set changes save
  automatically, call `store.save()` after editing a request in place.
- Documents (`tenant-app/lib/documents/`): pay stubs, bank statements, W-2s and 1040s, PDF or photo, read on the
  tenant's machine (unpdf for PDF text, tesseract.js OCR with the model from node_modules, never a download).
  Each document gets arithmetic checks (parse.ts), tamper signals and PDF signature verification (tamper.ts,
  pdf-signature.ts), and a cross-check against the bank's deposits (crosscheck.ts). analyze.ts decides which
  documents count and the evidence strength. `POST /api/documents` previews; `POST /api/approve` accepts the same
  multipart form with `mode=documents`. Files are processed in memory and never written or sent.
- Age check (`tenant-app/lib/documents/id-card.ts`): reads a government ID on the device: PDF417/AAMVA barcode
  (`zxing-wasm`, wasm loaded from node_modules), passport/ID-card MRZ via a second OCR pass with ICAO 9303 check
  digits, or front-of-card "DOB" text. `decideAge()` in analyze.ts turns it into yes/no. The date of birth lives in
  `IdReadResult.private` and must never reach a report, a response, a log line or the browser; the browser gets check
  labels and pass/fail only. `POST /api/approve` with `mode=age` on an `age_over` request signs the age claim; an
  unreadable, expired or failed ID posts a decline instead. `POST /api/documents` with `mode=age` previews the checks.
- Banks (`tenant-app/lib/bank.ts`): a demo account (`fetchDeposits`: Nessie or fixtures) or Plaid (`lib/plaid.ts`,
  sandbox by default, `PLAID_CLIENT_ID` / `PLAID_SECRET`). Plaid access tokens stay in process memory only.
- Keys: `npm run keys` writes `TENANT_APP_PRIVATE_JWK` (tenant-app/.env.local) and
  `TENANT_APP_PUBLIC_JWK` (landlord-portal/.env.local).

## Signed claim (ClaimPayload in shared/src/types.ts)
`{ aud, nonce, sub (pairwise), claim: ClaimBody, evidence: { source, strength, window_days, method }, build: { hash, integrity } }` + `iss`, `iat` (rounded down to the UTC day), `exp` (7 days).
`ClaimBody` is `{ type: "income_to_rent", multiple, rent, result }` or `{ type: "age_over", min_age: 18, result }`, with no
other fields (the portal rejects extras as malformed). Age claims always carry `AGE_EVIDENCE` from `shared/src/age.ts`
(`document` / `document_unverified` / 0 days / "government ID, date of birth"); anything else is malformed.
The portal checks the answer against the question with `claimAnswersQuestion` (type, then rent+multiple or min_age).
`evidence.source` is `"bank"` or `"document"`; `evidence.strength` is one of `bank`, `document_signed`,
`document_bank_matched`, `document_unverified` (claims from older builds without it count as `bank`).
`method` and `window_days` are fixed per source, never per tenant.
The portal checks, in order: signature, issuer, audience, expiry, nonce matches the open request, nonce not
already used, build hash trusted (when `TRUSTED_BUILD_HASHES` is set), question matches.

## Unlinkability (planned collusion test, see README)
Two landlords pooling their claims must not be able to tell they came from the same tenant. So: `sub` is
pairwise per audience; the signing key is shared by all tenants of a build (never per-tenant); don't add
any per-tenant field (device id, account id, exact timestamps, IP) to the claim or the portal's storage.
Evidence strength is the one deliberate exception, like `claim.result`: four coarse values the landlord needs to
judge the answer. Don't add finer detail (document types, bank names, employer) to the claim.

## Hard rules
1. The signed claim and anything sent to the portal must NEVER contain dollar amounts, balances, deposits or documents.
2. Never implement cryptography by hand. Use `jose` (and node:crypto / WebCrypto for hashing/HMAC only).
   Exception: verifying signatures inside PDFs needs CMS/PKCS#7, which `jose` doesn't do, so
   `tenant-app/lib/documents/pdf-signature.ts` uses PKI.js on top of WebCrypto. Test fixtures may use node-forge.
3. Never commit secrets. Secrets live in `*/.env.local` (git-ignored).
4. Don't change `shared/src/types.ts` or the signatures of `notifyTenant`, `fetchDeposits`, `evaluateIncome`,
   `checkIntegrity` without the owner agreeing; other people's code depends on them.
5. Keep `npm test` and `npm run smoke` passing. Add tests for new logic.
6. Small, focused changes. Don't reformat files you didn't need to touch.

## Owners (look for TODO(Name) in the code)
- Angelo: `tenant-app/lib/nessie.ts`, `tenant-app/lib/income.ts`, `scripts/seed-nessie.ts`, `docs/`
- Sam: `shared/`, `tenant-app/lib/integrity.ts`, `tenant-app/lib/documents/`, `tenant-app/lib/plaid.ts`,
  `landlord-portal/lib/store.ts`, signing/verification
- Boris: all UI (`app/page.tsx`, `consent.tsx`, `globals.css`), `messaging/`, `landlord-portal/lib/notify.ts`

## Commands
- `npm run setup`, `npm run dev`, `npm test`, `npm run smoke` (with dev running), `npm run build`
- `npm run sign-manifest` approves the current code (tamper check on); `npm run sign-manifest -- --reset` turns it off
- `npm run sample-docs` writes demo documents matching today's demo bank data to `sample-documents/`
- `npm run doc-accuracy` scores document reading on a labeled synthetic corpus, writes `docs/document-accuracy.md`
