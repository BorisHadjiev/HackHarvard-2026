# Need-to-Know

**Prove what matters. Keep the rest private.**

Need-to-Know answers a narrow question—“Is income at least 3× rent?” or “Are you at least 18?”—without sending bank statements or ID images to the requester. Built for HackHarvard 2026 with Capital One Nessie and Photon messaging.

[CI](https://github.com/BorisHadjiev/HackHarvard-2026/actions/workflows/ci.yml) · [Demo portal](https://need-to-know.onrender.com/) · [Threat model](docs/threat-model.md) · [Measured document accuracy](docs/document-accuracy.md)

## What works

A requester creates a question and shares the consent link, optionally by Photon text. The tenant service reads bank data or uploaded documents, computes the answer, and signs it with Ed25519. The portal checks the signature, audience, question, expiry, one-time nonce and configured build trust before displaying the answer and evidence level. Requests and used nonces persist across restarts.

Income can come from demo deposits, Capital One Nessie, Plaid sandbox, or PDF/photo documents: pay stubs, bank statements, W-2s and 1040s. The bank calculation uses recurring payers and a median month to exclude one-time transfers. Document checks include arithmetic, freshness, PDF signatures/tamper signals and optional comparison with bank deposits.

Age checks read a license PDF417/AAMVA barcode, a passport/ID machine-readable zone with check digits, or front-of-card DOB text. A usable adult ID returns yes; a usable minor ID returns no; unreadable, expired or failed IDs are declined. Birth dates and exact ages stay out of the public report and claim.

The current product serves landlord/tenant requests. The same minimum-disclosure approach could support age gates for communities such as Discord or hotel check-in, reducing the copies of identity documents those services retain. Those integrations and production identity assurance are future work.

## Run locally

Use Node.js 20+ and npm.

```bash
git clone https://github.com/BorisHadjiev/HackHarvard-2026.git
cd HackHarvard-2026
npm run setup
npm run dev
```

Open the portal at http://localhost:3000. Create an income or Age 18+ request, open its tenant link (tenant app at http://localhost:3001; stand-in bank signer at http://localhost:3002), review the disclosure and approve. Default demo tenants are Maya (income yes at $2,400 rent / 3×) and Leo (no). Without messaging credentials, the portal displays and logs the link.

For age and income document examples:

```bash
npm run sample-docs
```

The git-ignored `sample-documents/` directory includes income examples, a signed test pay stub, edited examples and seven age images. `README.txt` describes each file. Age specimens include an adult license front/back with PDF417, a minor aged 17 years 11 months, an expired license, a valid UTO passport, an edited MRZ and a rotated/blurred JPEG. All carry large specimen labels, fictional issuers/names and grey silhouettes. Dates are relative to generation day; regenerate before a demo. The command also configures a local test PDF signer; restart the tenant service afterward.

## Privacy and trust boundaries

Document processing happens in the **tenant service**, using locally installed OCR models and barcode WASM. To keep source files on the tenant's machine, run that service there. Uploading to a hosted tenant service sends the files to its server; this is not browser-only processing. The requester portal receives the signed answer and coarse evidence metadata, not the uploaded files or bank transactions.

Income evidence is labeled bank, signed documents, documents confirmed by bank, or documents only / not independently verified. Every age claim uses `document_unverified`: a barcode and valid MRZ check digits do not authenticate a government issuer or the person presenting the image. State-signed mobile driver's licenses with selective disclosure are the intended production path.

Claims bind the answer to a question, audience and nonce. They use a pairwise subject and day-rounded issuance time to reduce correlation. The collusion simulation measures the fields it models; it does not establish protection from network, account or device tracking. Software build checks also do not provide hardware attestation or make a locally held signing key inaccessible to its owner.

## Zero-knowledge income proofs

Demo bank income answers include a real Noir/Barretenberg proof. The separate bank signer signs a salted Pedersen commitment to the deposit list; the tenant proves the recurring-income predicate over that private list, bound to the rent, multiple and one-time request code. The portal verifies both the bank attestation and the proof and checks that the answer matches. Deposit amounts and payer details stay private. `npm run dev` starts the signer on port 3002; `npm run keys` configures its key and the portal's `TRUSTED_BANK_KEYS`.

When trusted bank keys are configured, bank-strength claims require the proof. This protects against changing the answer or substituting deposits without a matching bank attestation. It relies on the bank signing accurate data. The demo signer is an unauthenticated stand-in; a production issuer must control the signing key and authenticate data access. Documents, age and the current Plaid path do not use this proof.

Change the circuit in `zk/circuit/src/main.nr`, then run `npm run compile:zk` and commit the generated artifact. Additional adversarial end-to-end enforcement tests are in [integration PR #22](https://github.com/BorisHadjiev/HackHarvard-2026/pull/22).

## Configuration

`npm run keys` creates local signing keys. Keep secrets in git-ignored `*/.env.local`; never commit or paste them into logs.

- **Nessie:** set `NESSIE_API_KEY` and the demo account mappings in `tenant-app/.env.local`. See [seeding script](scripts/seed-nessie.ts) for account setup.
- **Plaid:** set `PLAID_CLIENT_ID` and `PLAID_SECRET` in the tenant app; sandbox is the default.
- **Photon:** set `PHOTON_API_KEY`, `PHOTON_PROJECT_ID`, `PHOTON_SENDER_ID` and optionally `PHOTON_PLATFORM` in the portal. See [messaging documentation](messaging/README.md). Set `PHOTON_INBOUND_SECRET` before exposing the inbound webhook. Demo YES replies approve income requests; age requires ID upload and consent.
- **Build trust:** `npm run sign-manifest` signs the current tenant build and configures its trusted hash. Regenerate after code changes. `npm run sign-manifest -- --reset` returns to unsigned development mode; development defaults are not production assurance.

## Validate changes

```bash
npm test
npm run build
npm run smoke          # requires both apps running
npm run collusion
npm run doc-accuracy
```

Smoke covers income yes/no, forged tokens, replay protection, an adult specimen through the full age flow, and replay of its exact signed claim. It skips age cleanly in checkouts without the ID reader. For alternate ports, set `PORTAL` and `TENANT` when invoking smoke.

Document accuracy generates a labeled synthetic income corpus and reports age outcomes separately for the seven specimens. A correct outcome is yes, no or decline as appropriate. CI compares income metrics with `main` on the same runner to account for platform-dependent OCR fonts, and requires every age outcome to match. Synthetic layouts do not establish accuracy on arbitrary real-world statements or IDs, nor do they demonstrate fraud resistance. `npm run doc-accuracy -- --people 30` expands the income corpus.

## Repository

- `shared/`: question/claim types, Ed25519 signing and verification, pairwise subjects.
- `zk/` and `bank-signer/`: income circuit, proof generation/verification and stand-in bank attestation.
- `tenant-app/`: consent, bank integrations, income evaluation, document/ID reading and local integrity checks.
- `landlord-portal/`: request creation, claim validation, durable request state and results.
- `messaging/`: Photon client and reply handling.
- `scripts/`: setup, specimens, smoke, accuracy and collusion checks.
- `docs/`: [age flow](docs/age-verification.md), [scanner work](docs/scanner-fixes.md), threat model and measurements.

Read [AGENTS.md](AGENTS.md) before contributing. Preserve the claim's minimum-disclosure contract, coordinate changes to shared types with Sam, and keep tests, builds and smoke green. The public deployment may lag repository changes; local validation is not evidence that a release has deployed.
