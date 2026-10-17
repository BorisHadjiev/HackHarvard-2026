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
- Keys: `npm run keys` writes `TENANT_APP_PRIVATE_JWK` (tenant-app/.env.local) and
  `TENANT_APP_PUBLIC_JWK` (landlord-portal/.env.local).

## Signed claim (ClaimPayload in shared/src/types.ts)
`{ aud, nonce, sub (pairwise), claim: { type: "income_to_rent", multiple, rent, result }, evidence: { source, window_days, method }, build: { hash, integrity } }` + `iss`, `iat`, `exp` (7 days).
The portal checks, in order: signature, issuer, audience, expiry, nonce matches the open request, nonce not
already used, build hash trusted (when `TRUSTED_BUILD_HASHES` is set), question matches.

## Hard rules
1. The signed claim and anything sent to the portal must NEVER contain dollar amounts, balances, deposits or documents.
2. Never implement cryptography by hand. Use `jose` (and node:crypto / WebCrypto for hashing/HMAC only).
3. Never commit secrets. Secrets live in `*/.env.local` (git-ignored).
4. Don't change `shared/src/types.ts` or the signatures of `notifyTenant`, `fetchDeposits`, `evaluateIncome`,
   `checkIntegrity` without the owner agreeing; other people's code depends on them.
5. Keep `npm test` and `npm run smoke` passing. Add tests for new logic.
6. Small, focused changes. Don't reformat files you didn't need to touch.

## Owners (look for TODO(Name) in the code)
- Angelo: `tenant-app/lib/nessie.ts`, `tenant-app/lib/income.ts`, `scripts/seed-nessie.ts`, `docs/`
- Sam: `shared/`, `tenant-app/lib/integrity.ts`, `landlord-portal/lib/store.ts`, signing/verification
- Boris: all UI (`app/page.tsx`, `consent.tsx`, `globals.css`), `messaging/`, `landlord-portal/lib/notify.ts`

## Commands
- `npm run setup`, `npm run dev`, `npm test`, `npm run smoke` (with dev running), `npm run build`
