# Threat model (Angelo, draft)

What the landlord learns: one signed yes/no for one question, tied to one request. Nothing else.

| Attack | What stops it in the demo | What production would use |
|---|---|---|
| Tenant edits the answer | Ed25519 signature; any change breaks it | Same |
| Tenant reuses an old "yes" | One-time nonce per request; portal rejects reuse | Same |
| Claim sent to a different landlord | `aud` must match the portal | Same |
| Tenant fakes bank data | Data comes from the bank API, not an upload | Bank-signed data (open banking) or zkTLS |
| Tenant inflates income with a one-time transfer | Only recurring payers count; median month | Richer payer classification |
| Tenant patches the app to always say yes | Tamper check refuses to sign; the landlord also requires a zero-knowledge proof over bank-signed deposits, which a patched app can't produce | Hardware attestation (App Attest / Play Integrity) plus the same proof |
| Tenant flips the yes/no or invents deposits | The proof's public answer must match the claim; the deposits must hash to what the bank signed | Same, with the real bank signing |
| Landlords track a tenant across applications | Pairwise subject: different ID per landlord | Same |

TODO(Angelo): turn this into one slide.
