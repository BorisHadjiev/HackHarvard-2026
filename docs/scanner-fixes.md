# Scanner fixes: why the demo bank statement was rejected

We ran `Bank_Statement_Demo (Below and Above Threshold).pdf` through the real pipeline
(`analyzeDocuments` in `tenant-app/lib/documents/analyze.ts`) on Oct 17, 2026. The PDF has a proper text layer,
so reading was fine: all 34 lines came out cleanly. The parser then found **zero deposits** and rejected it.

Result today:

| Check | Status | Why |
|---|---|---|
| deposits | fail | "No deposits found on the statement" |
| balance | info | "No opening and closing balance to check" |
| age | fail | "Dated in the future (2026-10-31)" |

## Causes

Two are gaps in our parser, which we fix. Two are problems in the test PDF, which the scanner was right to flag.

**Parser gaps (fix in code):**

1. **Month-name dates in transaction rows.** `TX_LINE` in `parse.ts` only accepts `10/03` style dates. This
   statement writes `Oct 03, 2026`, so not one row matched. `DATE_PATTERN` in `text.ts` already understands
   month names; the transaction regex should use it.
2. **A plus sign on credits.** Amounts like `+$2,900.00` don't match the amount pattern. Accept a leading `+`,
   and treat it as a deposit.
3. **Summary laid out as a header row over a value row.** The statement prints
   `STARTING BALANCE   TOTAL DEPOSITS   TOTAL WITHDRAWALS   ENDING BALANCE` on one line and the four amounts on
   the next. The parser expects "label: amount" on one line, and doesn't know "starting balance". Map labels to
   values by column order (split both rows on 3+ spaces) and add `starting` as a synonym of opening.
4. **Two statements in one file.** Page 1 and page 2 are separate statements (different employers, different
   balances, same period). Today they're merged into one. Split a PDF into separate statements when the statement
   header repeats on a new page, and report each one on its own.
5. **A category column.** Rows have `Description   Category   Amount`. Use the category as a hint: "Direct
   Deposit", "Deposit", "Credit" mean money in; "Debit", "Withdrawal", "POS", "ACH Withdrawal" mean money out.

**Problems in the test PDF (fix the file, not the checks):**

6. **The period ends Oct 31, 2026, two weeks from today.** A statement can't cover days that haven't happened, so
   "Dated in the future" is correct. Make test statements for a past month (September 2026).
7. **Withdrawals don't add up.** Page 1 lists $461.69 of withdrawals but states a total of $4,150.00; page 2 lists
   $605.59 against $5,200.00. Our withdrawal-total check would reject both once deposits parse. Either list all
   withdrawals or make the totals match the rows. (Deposits do add up: $5,800 and $8,800.)

Easiest path for test files: `npm run sample-docs` makes statements that pass every check and match the demo bank
data. Use those for the "it works" demo, and keep a hand-edited one for the "forgery caught" demo.

## Better messages

When a document is rejected, the tenant should see the first failing check in plain words ("No deposits found",
"Dated in the future", "Listed withdrawals don't add up"), not a generic failure. A document whose text came out
empty should say "Couldn't read any text. Try a sharper photo or the original PDF."

## Tests to add (`tenant-app/test/documents.test.ts`)

- The two pages of this statement, as text lines (copy them from section "Extracted lines" below), with the dates
  moved to September 2026 and the withdrawal rows completed: two reports, two deposits each, all checks pass;
  monthly income ≈ $5,800 and ≈ $8,800.
- The same lines with Oct 31, 2026 dates: fails only on "Dated in the future".
- The original lines (withdrawals incomplete): fails on the withdrawal total, with the message naming both numbers.
- Every existing document test still passes, and `npm run doc-accuracy` doesn't get worse.

## Extracted lines (page 1, as our extractor sees them)

```
FIRST NATIONAL BANK   ACCOUNT STATEMENT
Member FDIC | Equal Housing Lender   Statement Period: Oct 01, 2026 – Oct 31, 2026
Account Holder: Demo User   Account Number: ********4821
Address: 123 Harbor View Way, Apt 4B   Primary Phone: (555) 019-2831
Account Type: Preferred Checking   Branch: Downtown Financial Center
STARTING BALANCE   TOTAL DEPOSITS   TOTAL WITHDRAWALS   ENDING BALANCE
$3,120.00   $5,800.00   $4,150.00   $4,770.00
Account Activity & Deposits
Date   Description   Category   Amount
Oct 03, 2026   GROCERY MARKET #4021   POS Debit   -$142.50
Oct 08, 2026   CITY UTILITIES WATER & POWER   ACH Withdrawal   -$118.20
Oct 15, 2026   ACME CORP PAYROLL DIRECT DEP   Direct Deposit   +$2,900.00
Oct 20, 2026   STREAMING SERVICE MONTHLY   Recurring Debit   -$15.99
Oct 25, 2026   AUTO INSURANCE MONTHLY PREMIUM   ACH Withdrawal   -$185.00
Oct 31, 2026   ACME CORP PAYROLL DIRECT DEP   Direct Deposit   +$2,900.00
Total Direct Deposits   $5,800.00
First National Bank — Demo Statement   Page 1 of 2
```

Page 2 has the same layout: starting $6,450.00, deposits $8,800.00 (two TECH CORP PAYROLL deposits of $4,400.00),
withdrawals stated $5,200.00 but listed $605.59, ending $10,050.00.
