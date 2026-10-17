# Zero-knowledge income verification

This is the integration and acceptance checklist for Sam's zero-knowledge implementation in PR #15. It is not a claim that the public Render deployment has these changes enabled.

## What the proof establishes

The separate demo bank signer reads an account's deposits and signs a freshly salted commitment to the list. Noir and Barretenberg prove that the recurring-payer, three-month median rule applied to that committed list produces the claimed income-to-rent answer. The portal verifies both the bank attestation and the proof, with the circuit verification key and request inputs it expects.

Deposits, payer identifiers, the commitment salt, and the private median income are not forwarded to the landlord. Public proof inputs include the salted commitment, evaluation day, landlord-set rent and multiplier, a tag derived from the request nonce, and the yes/no output. The rent threshold is already known to the landlord; it is not the tenant's private income amount.

A proof is required for bank-strength claims when the portal has `TRUSTED_BANK_KEYS` configured. An ordinary signed claim alone must then be rejected. The portal records a `proof: "zk"` flag only after it verifies the proof and confirms that the signed answer agrees.

## Reproduce locally

1. Run `npm ci` and `npm run keys`. Existing tenant signing keys are preserved. The setup also creates a separate, git-ignored demo bank key and configures the portal's trusted bank public key.
2. Run `npm run build`.
3. Start all three services: `npm run start -w landlord-portal`, `npm run start -w tenant-app`, and `npm run start -w bank-signer` (ports 3000, 3001, and 3002).
4. Run `npm run smoke` to exercise the tenant approval API, including verified YES and NO proofs.
5. Run `npm run smoke:zk` to test enforcement and attacks through the real portal and bank signer.
6. Run `npm test` and `npm run collusion`.

`PORTAL`, `TENANT`, and `BANK_SIGNER_URL` can target isolated local services. The bank port is configurable with `BANK_SIGNER_PORT`. Barretenberg caches public reference-string data; a sandbox can set `CRS_PATH` to a writable directory, for example `/private/tmp/ntk-zk-crs`. No secret key belongs in a command argument, a report, or the repository.

## Automated acceptance checks

- Bank claim with no proof: `proof_required`.
- Corrupted proof: `bad_proof`.
- Attestation from an untrusted signing key: `bad_bank_attestation`.
- Proof moved to another request: rejected.
- Signed answer differs from the proof output: `proof_mismatch`.
- Genuine Maya proof: verified YES with `proof: "zk"`.
- Reuse of the accepted request: `replayed`.
- Genuine Leo proof: verified NO; his one-time transfer does not count.
- Public result exposes only verdict and verification metadata, not the private witness or proof payload.

The circuit test also mutates each public input and the expected value together while keeping the original proof bytes. This must fail cryptographic verification: checking equality in a wrapper alone is insufficient.

## Scope and limits

This is an income proof. It does not yet add a zero-knowledge age proof, and it does not make a photographed ID authentic. Age photo evidence remains `document_unverified`.

The signer is a demo stand-in, not a bank-issued production credential or a deployed Capital One attestation service. Its key and API must not be controlled by an untrusted tenant in a production architecture. A real bank or independently trusted provider would authenticate the user and attest to source data. The demo signer must not be exposed as an unauthenticated production bank-data endpoint.

Zero knowledge protects the private witness; it does not make a lying trusted signer truthful. It also does not stop a compromised client from exposing data locally, secure the transport by itself, establish account ownership, or guarantee anonymity against network/browser metadata. The current circuit accepts a bounded list of at most 32 deposits; production support needs an explicit policy for larger histories rather than silently presenting this limit as arbitrary-account coverage.

Do not label document-only, age-photo, or unsupported bank flows as ZK verified. A Render rollout needs the reviewed circuit artifact, trusted bank public keys, the separate signer service, and a reachable tenant prover. A successful local test does not establish that the public website has those settings.
