# Age verification (18+)

**Not built.** This file is the plan. On `main` the only question is income ≥ a multiple of rent (`income_to_rent` in `shared/src/types.ts`). The checklist in section 6 is still open.

The intended flow: a landlord asks a second question, **is this tenant at least 18?** The tenant uploads a photo or PDF of a
government ID, the tenant app reads the date of birth on the tenant's own machine, and the landlord gets a signed
yes or no. The date of birth, name, address and ID number never leave the laptop and never appear in the claim.

It uses exactly the same trust chain as the income check: one-time nonce, pairwise `sub`, Ed25519 signature with
`jose`, build hash, replay rejection, day-rounded `iat`. Only the question and the way the answer is computed change.

Read `AGENTS.md` first. Its hard rules all apply here, and rule 4 matters most: **the claim format in
`shared/src/types.ts` is Sam's, and nothing below changes it until Sam has agreed.** The contract in section 3 is a
proposal for Sam to accept or amend.

## 1. What the judges see

1. Landlord portal (need-to-know.onrender.com): the request form has a choice, **Income ≥ 3× rent** or
   **Age 18+**. The landlord picks Age 18+, enters the tenant's phone, sends.
2. The tenant gets a text: "Demo Property Co. asks: are you at least 18?" with the link.
3. Tenant app consent screen: "This landlord will learn one thing: whether you are 18 or older. Your date of birth,
   name and ID number stay on this device." Upload an ID (photo or PDF).
4. The app shows what it read, locally: document type, "date of birth found", "not expired", and the checks it ran.
   It never shows the date of birth on screen either, so a judge can watch the screen without seeing it.
5. Tenant taps Approve. The portal shows **✓ 18 or older**, with the evidence label, and nothing else.
6. Attack replay: resubmit the same claim → rejected, exactly as with income.

## 2. How the tenant app reads an ID

Order of preference. Each step runs only on the laptop, with libraries loaded from `node_modules` (never a
download at runtime, same rule as the OCR model).

| Source | What it gives | How reliable | Library |
|---|---|---|---|
| PDF417 barcode on the back of a US driver's license or state ID (AAMVA format) | Date of birth (`DBB`), expiry (`DBA`), issuing jurisdiction | High: it's machine data, no OCR guessing | `zxing-wasm` (decode only, wasm file served from `node_modules`) |
| Machine-readable zone (MRZ) on a passport (TD3, 2 lines × 44) or ID card (TD1, 3 lines × 30) | Date of birth, expiry, nationality, with **check digits** | High when the check digits pass | OCR with tesseract, then a hand-written MRZ parser (it's text parsing, not crypto) |
| Front of the card, OCR | "DOB" / "Date of Birth" / "BIRTH" followed by a date | Medium | the existing tesseract pipeline |

Checks the ID report shows (same `DocumentCheck` shape as the income documents):

- **dob_found**: a date of birth was read. Fail if not.
- **dob_plausible**: not in the future, age under 120.
- **not_expired**: expiry date is after today. Fail if expired.
- **mrz_check_digits**: all MRZ check digits pass (passports and ID cards). Fail on any mismatch: a hand-edited
  date almost always breaks a check digit.
- **barcode_matches_front**: when both the barcode and the front OCR give a date of birth, they agree. Warn
  (not fail) on mismatch, since OCR can misread one digit.
- The existing PDF tamper signals (edited-after-creation, incremental saves) also run on PDF uploads.

The answer is `age_on(today_utc) >= 18`, computed in the tenant app.

**Honest limit, say it in the pitch:** a photo of an ID can be forged and nothing on the laptop can prove it came
from a real state DMV. So every age claim in this build carries `strength: "document_unverified"`. The real-world
version reads a mobile driver's license (ISO/IEC 18013-5), which the issuing state signs, and would then carry
`document_signed`. That's the "what's next" line.

## 3. Claim contract (proposal, needs Sam's OK)

```ts
// shared/src/types.ts
export type ClaimType = "income_to_rent" | "age_over";

export interface AgeOverQuestion {
  type: "age_over";
  /** Only 18 in this build. A fixed set of thresholds keeps tenants in large, identical groups. */
  min_age: 18;
}
export type Question = IncomeToRentQuestion | AgeOverQuestion;

export type ClaimBody =
  | { type: "income_to_rent"; multiple: number; rent: number; result: boolean }
  | { type: "age_over"; min_age: 18; result: boolean };

// ClaimPayload.claim becomes ClaimBody. Everything else in ClaimPayload is unchanged.
```

Evidence for every age claim, fixed (the unlinkability rule: one value per source, never per tenant):

```ts
evidence: { source: "document", strength: "document_unverified", window_days: 0, method: "government ID, date of birth" }
```

Never in the claim, the request, the portal's store, the text message or the logs: date of birth, age in years,
birth year, name, address, ID number, document type (license vs passport), issuing state or country, expiry date.
Age in years is the tempting one. It splits tenants into ~80 groups and must stay out.

Portal check (`landlord-portal/app/api/claims/route.ts`), replacing the rent/multiple comparison:

- `claim.claim.type` must equal `request.question.type`, else `wrong_question`.
- income: `rent` and `multiple` must match, as today.
- age: `min_age` must equal the request's `min_age`.

Old income claims keep working unchanged, because their shape is identical to the income branch of the union.

## 4. Who does what, in order

| # | Who (tool) | What | Main files | Depends on |
|---|---|---|---|---|
| 0 | Angelo (terminal) | Tag the working build `demo-stable` before anything else lands | — | — |
| 1 | Sam (Claude) | Claim contract, portal request + verify, claim builder, collusion test with age claims | `shared/src/types.ts`, `shared/src/claims.ts`, `landlord-portal/app/api/requests/route.ts`, `landlord-portal/app/api/claims/route.ts`, `tenant-app/lib/claim.ts`, `scripts/collusion-test.ts` | 0 |
| 2 | Angelo (Codex) | Bank-statement scanner fixes (see `docs/scanner-fixes.md`) | `tenant-app/lib/documents/parse.ts`, `extract.ts`, `analyze.ts`, tests | 0, Sam's OK on touching `lib/documents/` |
| 3 | Sam (Claude) | ID reader: classify `id_card`, barcode + MRZ + front OCR, checks, age decision, approve route `mode=age` | `tenant-app/lib/documents/id-card.ts` (new), `parse.ts` classify, `analyze.ts`, `tenant-app/app/api/approve/route.ts` | 1, 2 merged |
| 4 | Boris (Cursor) | UI: question picker and result on the portal, age consent screen, text wording | `landlord-portal/app/page.tsx`, `tenant-app/app/request/[id]/consent.tsx`, `page.tsx`, `globals.css` | 1 merged (can start against the contract above) |
| 5 | Angelo (Codex) | Specimen ID fixtures, accuracy corpus, smoke test for age, docs | `scripts/sample-documents.ts`, `scripts/lib/sample-documents.ts`, `scripts/document-accuracy.ts`, `scripts/smoke-test.ts`, `docs/threat-model.md` | 1 |

The copy-paste prompts (one per person, covering these steps) are in `docs/age-verification-prompts.md`.
Each step is its own branch and PR into `main`, with a green CI check before merging. Nobody merges a PR that
changes the claim format except Sam.

**Timing.** The MVP is frozen and working. Aim: scanner fixes merged by 9 PM, age flow working end to end by
1 AM, final freeze 2 AM. If age isn't solid by 2 AM, the demo stays on `demo-stable` and age goes in the
"what's next" slide. Never demo from an untested build.

## 5. Specimen IDs for testing

We need fake IDs to test the scanner. They must never pass for real documents:

- Every image carries **"SPECIMEN · NOT A GOVERNMENT DOCUMENT"** across the face, large.
- Issuer is fictional: "State of Demo" for the license, and **UTO (Utopia)**, the fictional country ICAO uses in
  its own MRZ examples, for the passport.
- Names are obviously fake ("DEMO, ADULT", "DEMO, MINOR"). No real photo: a grey silhouette.
- Generated by `npm run sample-docs` into git-ignored `sample-documents/`, dates relative to today, so one adult
  (25 years old), one minor (17 years and 11 months, to test the boundary), one expired adult ID, and one passport
  whose MRZ date was edited (check digit fails).
- The PDF417 barcode is produced with `bwip-js` (dev dependency, fixtures only) using the AAMVA layout.

## 6. Done when

- [ ] `npm test`, `npm run smoke`, `npm run collusion` all pass in CI
- [ ] Portal can create an Age 18+ request; the text says "are you at least 18?"
- [ ] Adult specimen license (barcode) → ✓ on the portal; minor specimen → ✗ (a signed no); expired → declined
- [ ] Specimen passport with a correct MRZ → ✓; edited MRZ → declined with "check digit doesn't match"
- [ ] A phone photo of the adult specimen (slight rotation, JPEG) still reads
- [ ] The age claim, decoded, contains only the fields in section 3
- [ ] Collusion test with mixed income and age claims stays at random-guess accuracy
- [ ] Replaying an age claim is rejected
- [ ] Income flow, including the texted YES, still works exactly as before
