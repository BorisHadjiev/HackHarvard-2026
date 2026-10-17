# Collusion demo

Run `npm run collusion`. It needs no servers, `.env.local`, or real bank data.

The script creates one build signing key, two landlord requests, and twenty
synthetic tenants with distinct secrets. Every tenant passes the same income
question and answers both landlords. The approval route and this script both
call `buildClaimPayload(request, tenant, income, integrity)`, then the real
`signClaim`. The tenant input is `{ id, secret }`; the builder reads no environment,
time, or bank data, and preserves the route's existing subject derivation.

For the requested two-request scenario, each landlord's nonce is constant across
its twenty synthetic answers. These are request templates for an in-process
experiment; a real portal request accepts only one claim per nonce.

## Attacker and measurement

The attacker receives decoded JWT payloads only. Private tenant labels stay in
separate arrays until scoring. Input orders differ between landlords. Audit
every flattened leaf, including nested and optional values:

- `same for everyone`: the value is constant across both landlord datasets.
- `different per landlord`: values are constant within each landlord, or vary
  without overlap across landlords (as pairwise subjects should).
- `LINKING`: a varying field has overlapping values across landlords. This is
  conservatively a *potential* link; repeated values can narrow a group without
  uniquely identifying an individual.

Matching scores equality on every nonconstant field, including audience, nonce,
subject, and timestamps. It produces one-to-one assignments, randomizing order
and ties, and averages accuracy over 1,000 reproducible trials. A clean cohort's
baseline is 1/20 = 5%. The verdict allows three standard errors above that rate
(about 0.47 percentage points for this experiment). Seeds control simulation
randomness only; key generation and tenant secrets use the existing crypto APIs.

## Timing and verdict

`signClaim` rounds `iat` down to the start of the UTC day and sets `exp` from
that rounded value (`shared/src/claims.ts`). Tenants in this script still sign
at different minutes within one hour, on the same UTC day, so `iat` and `exp`
are the same on every claim. They classify as `same for everyone`, the timing
warning stays quiet, and the all-field accuracy is the number to quote.

If a future change makes `iat` or `exp` classify as `LINKING`, the script warns
and exempts only those two fields from the pass/fail verdict. Any other linking
field, or accuracy above the noise threshold, fails the process. A leaked tenant
ID is tested to produce LINKING and 100% accuracy even when timing fields are
excluded. The script does not replace `signClaim`.

This is an equality-based regression experiment for one synthetic cohort, not a
proof against every attacker. No claims are made about network metadata, different
questions or answers, cross-field transformations, or arbitrary timing patterns.
