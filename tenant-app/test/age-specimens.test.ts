import { after, test } from "node:test";
import assert from "node:assert/strict";
import { ageSpecimens } from "../../scripts/lib/sample-documents";
import { analyzeIdDocuments, decideAge } from "../lib/documents/analyze";
import { ageOn, parseAamva, readPdf417 } from "../lib/documents/id-card";
import { stopOcr } from "../lib/documents/ocr";

after(() => stopOcr());
test("finished specimen images: adult, boundary minor, expired, checked MRZ and phone photo", { timeout: 180_000 }, async () => {
  const now = new Date("2026-10-17T12:00:00Z");
  for (const f of await ageSpecimens(now)) {
    const reads = await analyzeIdDocuments([f], now);
    const decision = decideAge(reads, 18, now);
    assert.deepEqual({ usable: decision.usable, meets: decision.meets }, f.expected, f.name);
    if (f.name === "adult-license-back.png") assert.match(decision.reports[0].checks[0].label, /barcode/);
    if (f.name.includes("passport")) assert.equal(decision.reports[0].checks.find(c => c.id === "mrz_check_digits")?.status, f.expected.usable ? "pass" : "fail");
    if (f.name === "minor-license.png") {
      assert.equal(reads[0].private.dob, "2008-11-17");
      assert.equal(ageOn(reads[0].private.dob!, now), 17);
    }
    const publicReport = JSON.stringify(decision);
    assert.equal(publicReport.includes(reads[0].private.dob ?? "NEVER_MATCH"), false);
    assert.deepEqual(decision.reports[0].fields, {});
  }
});
test("relative specimen birthdays clamp leap days and month ends", { timeout: 60_000 }, async () => {
  for (const date of ["2028-02-29", "2026-03-31"]) {
    const now = new Date(date + "T12:00:00Z");
    const back = (await ageSpecimens(now)).find(f => f.name === "adult-license-back.png")!;
    const fields = parseAamva((await readPdf417(back.data))!)!;
    assert.equal(ageOn(fields.dob!, now), 25);
    assert.ok(fields.expiry! > date);
  }
});
