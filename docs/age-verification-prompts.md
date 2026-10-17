# Prompts for the age-verification build

One prompt per person. Run `git checkout main && git pull` before pasting. The spec is
`docs/age-verification.md` and the scanner diagnosis is `docs/scanner-fixes.md`.

Order: Angelo tags `demo-stable` first (terminal, below). Sam's part A unblocks everyone else's age work. Angelo's
part A (scanner fixes) needs nothing and can start right away.

## Angelo: terminal first, then Codex

```
cd ~/HackHarvard-2026
git checkout main && git pull
git tag demo-stable
git push origin demo-stable
```

Then ask Sam: "OK if Codex edits tenant-app/lib/documents/ for the scanner fixes?" Once he says yes, paste into Codex:

```
Read AGENTS.md, docs/scanner-fixes.md and docs/age-verification.md (sections 5 and 6). I'm Angelo. Sam owns
tenant-app/lib/documents and has agreed to the scanner fixes. Do this as two separate PRs into main.

PART A, now. Branch angelo/scanner-fixes from main. Fix the five parser gaps in docs/scanner-fixes.md:
1. Transaction rows with month-name dates ("Oct 03, 2026", "Oct 3"): reuse DATE_PATTERN / parseDate from text.ts
   in the transaction regex in parse.ts.
2. Amounts with a leading plus sign ("+$2,900.00") count as deposits.
3. Summary blocks printed as a row of labels over a row of amounts: map each label to the amount in the same
   column (split both rows on 3+ spaces). Add "starting balance" as an opening-balance synonym.
4. Several statements in one PDF: keep page boundaries from extract.ts, start a new statement when the statement
   header repeats on a new page, and return one DocumentReport per statement ("name.pdf (page 2)").
5. Use a category column ("Direct Deposit", "POS Debit", "ACH Withdrawal") to tell money in from money out.
Also show the tenant the first failing check's label when a document is rejected, instead of a generic message,
and if no text was found at all say "Couldn't read any text. Try a sharper photo or the original PDF."
Don't loosen any check: "Dated in the future" and a withdrawal total that doesn't match the listed rows must still
fail. Add the tests listed in docs/scanner-fixes.md using the extracted lines in that file, with September 2026
dates for the passing case. Make the sample bank statements from npm run sample-docs cover a past full month.
npm test, npm run build and npm run doc-accuracy must pass, and doc-accuracy must not get worse. Open the PR.

PART B, only once Sam's age-claim PR is merged: after git pull, shared/src/types.ts must contain "age_over".
If it doesn't, stop after part A and tell me. Branch angelo/age-fixtures from main.
1. scripts/sample-documents.ts and scripts/lib/sample-documents.ts: specimen IDs, dates relative to today:
   adult license (age 25) as front and back PNG with an AAMVA PDF417 barcode made with bwip-js (dev dependency),
   minor license (17 years 11 months), expired adult license, a UTO passport photo page with a correct MRZ, the
   same passport with one MRZ date digit changed, and a rotated, slightly blurred JPEG of the adult license like a
   phone photo. Every image carries "SPECIMEN · NOT A GOVERNMENT DOCUMENT" across the face in large text, a
   fictional issuer ("State of Demo", country UTO), names "DEMO, ADULT" / "DEMO, MINOR", and a grey silhouette
   instead of a photo. One README line per file, as the script already does.
2. scripts/document-accuracy.ts: add the ID fixtures to the labeled corpus and report age accuracy separately.
3. scripts/smoke-test.ts: an age_over request end to end with the adult specimen -> verified yes, and a replay of
   that claim -> rejected. Skip the age part cleanly if the ID reader isn't merged yet.
4. docs/threat-model.md: add "Age check" (what a forged ID photo can and can't do, why strength is
   document_unverified, mobile driver's licenses as the real fix).
npm test, build, smoke and doc-accuracy must pass. Open the PR.
```

## Sam: Claude

```
Read AGENTS.md and docs/age-verification.md. I'm Sam, owner of shared/, signing and tenant-app/lib/documents.
I approve the claim contract in section 3 of that doc (if I want changes, edit section 3 first and tell Angelo and
Boris). Do this as two separate PRs into main.

PART A, now: the claim and the portal. Branch sam/age-claim from main.
1. shared/src/types.ts: ClaimType "age_over", AgeOverQuestion { type: "age_over"; min_age: 18 }, the Question
   union, the ClaimBody union, ClaimPayload.claim: ClaimBody. Old income claims stay valid unchanged.
2. Export AGE_METHOD = "government ID, date of birth" and AGE_WINDOW_DAYS = 0 from one place; age evidence is
   always { source: "document", strength: "document_unverified", window_days: 0, method: AGE_METHOD }.
3. tenant-app/lib/claim.ts: an age claim builder next to the income one (same pairwise sub, day-rounded iat,
   signClaim, build hash). It takes only a boolean result, never a date of birth or an age.
4. landlord-portal/app/api/requests/route.ts: accept { type: "age_over", tenantPhone? } as well as the income body
   (income stays the default). Text summary for age: "<requester> asks: are you at least 18?"
5. landlord-portal/app/api/claims/route.ts: replace the rent/multiple comparison with a type-aware check (types
   must match; income compares rent and multiple; age compares min_age), else wrong_question.
6. scripts/collusion-test.ts: pool a mix of income and age claims from several tenants across two portals; matching
   must stay at the random baseline. Add a unit test that a decoded age claim has exactly the allowed fields and no
   date, age or name.
npm test, build and collusion must pass; start both apps and run npm run smoke. Open the PR, then tell Boris
and Angelo it's up. Don't touch UI files.

PART B, once part A is merged (and Angelo's scanner-fix PR if it's merged; otherwise rebase on it later): the ID
reader. Branch sam/id-reader from main. Follow docs/age-verification.md section 2.
1. tenant-app/lib/documents/id-card.ts (new), all on this device:
   - PDF417 barcode (AAMVA) with zxing-wasm, loading its .wasm from node_modules (configure the locator so it never
     fetches from a CDN). Read DBB (date of birth), DBA (expiry), issuer.
   - MRZ: OCR with the existing tesseract setup, find TD3 (2x44) or TD1 (3x30) lines, parse date of birth and expiry,
     verify every ICAO 9303 check digit.
   - Front OCR fallback: "DOB", "Date of Birth" or "BIRTH" followed by a date.
   Checks: dob_found, dob_plausible, not_expired, mrz_check_digits, barcode_matches_front, plus the existing PDF
   tamper checks for PDFs. The date of birth stays in memory: never logged, never in a response, never sent to the
   browser. The browser gets only check labels and pass/fail.
2. parse.ts classify(): recognise "id_card". The income path ignores id_card reports; the age path ignores income
   documents.
3. analyze.ts: decideAge(reports, minAge) -> { meets, usable, reason }, age computed on today's UTC date.
4. tenant-app/app/api/approve/route.ts: for an age_over request, accept the same multipart form, run the ID reader
   and sign with the age builder. A usable ID under 18 is a signed "no"; an unreadable, expired or failed ID is
   "declined" with nothing signed. tenant-app/app/api/documents/route.ts preview returns the ID checks.
Tests with Angelo's specimen fixtures if merged, otherwise small fixtures in the test file (an AAMVA string; ICAO's
published UTO specimen MRZ): adult -> yes, 17 years 11 months -> no, expired -> declined, edited MRZ digit ->
declined, and no response body or log line contains the date of birth. npm test, build and smoke must pass.
Open the PR.
```

## Boris: Cursor

```
Read AGENTS.md and docs/age-verification.md, sections 1 and 3. I'm Boris (UI). Start once Sam's sam/age-claim PR
is open: branch boris/age-ui from main, and rebase on sam/age-claim if it isn't merged yet. Only UI files:
landlord-portal/app/page.tsx, tenant-app/app/request/[id]/consent.tsx and page.tsx, globals.css.

1. Landlord portal: on the request form, a two-option choice "Income ≥ 3× rent" / "Age 18+". Age hides the rent
   fields and posts { type: "age_over", tenantPhone }. The requests list and the result show "✓ 18 or older",
   "✗ Under 18" or "Declined" with the evidence label, and nothing else.
2. Tenant consent screen for age requests: headline "Prove you're 18 or older" and one line: "The landlord learns
   only yes or no. Your date of birth, name and ID number stay on this device." Upload takes a photo or PDF of a
   driver's license (the back with the barcode works best), state ID or passport photo page. Show the checks the
   app ran with pass/fail icons. Never show the date of birth, even locally (judges watch the screen).
3. The income flow stays exactly as it is, including the document upload from PR #14. Match the existing design.
npm run build must pass. Try both flows by hand on localhost, including a phone-width window. Open a PR into main.
```

## After everything is merged

Re-run the morning checklist (Demo-day setup tab): pull, rebuild and restart the tenant app, keep the tunnel,
update `TENANT_APP_URL` if the tunnel changed. Check that Render deployed the latest `main` (the portal half lives
there; trigger a manual deploy if it didn't). Then test both flows from the phone.
