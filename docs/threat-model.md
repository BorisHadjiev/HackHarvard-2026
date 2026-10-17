# Threat model

The requester learns one signed yes/no for one question, tied to one request, plus coarse evidence and verification metadata.

| Attack | What stops it in the demo | What production would use |
|---|---|---|
| Tenant edits the answer | Ed25519 signature; any change breaks it | Same |
| Tenant reuses an old "yes" | One-time nonce per request; portal rejects reuse | Same |
| Claim sent to a different landlord | `aud` must match the portal | Same |
| Tenant fakes bank data | Data comes from the bank API, not an upload | Bank-signed data (open banking) or zkTLS |
| Tenant inflates income with a one-time transfer | Only recurring payers count; median month | Richer payer classification |
| Tenant patches the app to always say yes | Tamper check refuses to run/sign (software) | Hardware attestation (App Attest / Play Integrity) |
| Landlords track a tenant across applications | Pairwise subject: different ID per landlord | Same |

The local signing key and software integrity check are demo trust assumptions. A user who controls
the signing environment can bypass software-only checks; they are not hardware attestation.

## Age check

The tenant service reads an ID image locally and sends a signed answer to the fixed 18+ question.
The verifier also learns the coarse evidence level and verification time. The date of birth, exact
age, name, address, issuer, document number and uploaded image are excluded from the claim.
Files are processed in memory by the tenant service; run that service on a trusted local machine.
A centrally hosted tenant service would receive the uploads and changes that privacy boundary.

A forged photo can carry invented birth dates and expiry dates. PDF417 is an encoding, not an issuer
signature. MRZ check digits detect accidental errors and simple edits; an attacker can recompute
all of them. Expiry, plausibility, barcode/front agreement and check-digit checks improve reading
and consistency, but cannot establish that an ID was issued by a government or belongs to the presenter.
The specimen corpus deliberately demonstrates this limit: a completely fictional adult ID gives yes.
Age evidence therefore remains `document_unverified`. The signed token establishes which app signed
an answer and binds it to an audience and nonce; it does not authenticate the underlying photo.
Replay protection rejects reuse of that claim. It does not prevent a new request using a forged image.

A state-signed mobile driver's license with selective disclosure (ISO/IEC 18013-5) is the production
path: validate issuer trust, signature, freshness and holder/session binding, and disclose only the
age predicate. Presentation and anti-replay protocols still matter. Discord-like communities,
hotels and other age-gated services are potential relying parties; this demo supplies neither their
production integrations nor an identity-assurance/compliance guarantee. Age verification here is
not a zero-knowledge proof. The separate income ZK integration does not upgrade an ID photo's trust.
