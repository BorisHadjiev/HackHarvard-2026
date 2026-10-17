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
- Banks (`tenant-app/lib/bank.ts`): a demo account (`fetchDeposits`: Nessie or fixtures) or Plaid (`lib/plaid.ts`,
  sandbox by default, `PLAID_CLIENT_ID` / `PLAID_SECRET`). Plaid access tokens stay in process memory only.
- Zero-knowledge proof (`zk/`, `bank-signer/`): for demo bank accounts the tenant app asks the stand-in bank
  (`bank-signer/`, :3002) to sign a salted Pedersen commitment to the deposits, then proves in Noir/Barretenberg
  (`zk/circuit/src/main.nr`) that "median recurring month >= multiple x rent" holds for exactly that list, bound to
  the request's one-time code. The portal (`landlord-portal/lib/proof.ts`) verifies the bank signature
  (`TRUSTED_BANK_KEYS`) and the proof, and requires both for bank-strength claims when a bank key is set.
  Circuit changes: edit main.nr, run `npm run compile:zk` (writes `zk/artifacts/income_to_rent.ts`), commit it.
- Keys: `npm run keys` writes `TENANT_APP_PRIVATE_JWK` (tenant-app/.env.local), the bank signer key, and
  `TENANT_APP_PUBLIC_JWK` + `TRUSTED_BANK_KEYS` (landlord-portal/.env.local). Existing keys are kept; `--rotate` replaces them.

## Signed claim (ClaimPayload in shared/src/types.ts)
`{ aud, nonce, sub (pairwise), claim: { type: "income_to_rent", multiple, rent, result }, evidence: { source, strength, window_days, method }, build: { hash, integrity } }` + `iss`, `iat` (rounded down to the UTC day), `exp` (7 days).
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
   Zero-knowledge proofs use Noir + Barretenberg (`@noir-lang/noir_js`, `@aztec/bb.js`), never hand-rolled.
   Exception: verifying signatures inside PDFs needs CMS/PKCS#7, which `jose` doesn't do, so
   `tenant-app/lib/documents/pdf-signature.ts` uses PKI.js on top of WebCrypto. Test fixtures may use node-forge.
3. Never commit secrets. Secrets live in `*/.env.local` (git-ignored).
4. Don't change `shared/src/types.ts` or the signatures of `notifyTenant`, `fetchDeposits`, `evaluateIncome`,
   `checkIntegrity` without the owner agreeing; other people's code depends on them.
5. Keep `npm test` and `npm run smoke` passing. Add tests for new logic.
6. Small, focused changes. Don't reformat files you didn't need to touch.

## Owners (look for TODO(Name) in the code)
- Angelo: `tenant-app/lib/nessie.ts`, `tenant-app/lib/income.ts`, `scripts/seed-nessie.ts`, `docs/`
- Sam: `shared/`, `zk/`, `bank-signer/`, `tenant-app/lib/integrity.ts`, `tenant-app/lib/documents/`, `tenant-app/lib/plaid.ts`,
  `tenant-app/lib/zk-prove.ts`, `landlord-portal/lib/store.ts`, `landlord-portal/lib/proof.ts`, signing/verification
- Boris: all UI (`app/page.tsx`, `consent.tsx`, `globals.css`), `messaging/`, `landlord-portal/lib/notify.ts`

## Commands
- `npm run setup`, `npm run dev`, `npm test`, `npm run smoke` (with dev running), `npm run build`
- `npm run sign-manifest` approves the current code (tamper check on); `npm run sign-manifest -- --reset` turns it off
- `npm run sample-docs` writes demo documents matching today's demo bank data to `sample-documents/`
- `npm run doc-accuracy` scores document reading on a labeled synthetic corpus, writes `docs/document-accuracy.md`
