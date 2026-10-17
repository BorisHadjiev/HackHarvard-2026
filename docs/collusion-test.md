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

## Timing warning and verdict

Tenants sign at different minutes within one hour; each tenant answers both
landlords at its assigned time. Until `sam/round-iat` lands, exact `iat` and derived
`exp` link every pair. Print their classifications and the actual all-field
accuracy, then print a separate timing-exempt result. Only `iat` and `exp` are
exempted from failure for this known issue; any other linking field or accuracy
above the noise threshold fails the process. A leaked tenant ID is tested to
produce LINKING and 100% accuracy even when timing fields are excluded.

Once Sam rounds `iat` to the hour and derives `exp` from it, these fields become
constant in this cohort and the warning automatically disappears. No signing
logic is changed or overridden by the demo.

The pitch line includes the measured timing-exempt accuracy and the all-field
result. Until the timestamp fix lands, do not present the 5% result as the
security of the complete current payload.

This is an equality-based regression experiment for one synthetic cohort, not a
proof against every attacker. No claims are made about network metadata, different
questions or answers, cross-field transformations, or arbitrary timing patterns.
