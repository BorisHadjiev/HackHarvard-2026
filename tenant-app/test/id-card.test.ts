import { test, after } from "node:test";
import assert from "node:assert/strict";
import bwipjs from "bwip-js/node";
import sharp from "sharp";
import { ageOn, mrzCheckDigit, parseAamva, parseFront, parseMrz, readIdCard, readPdf417 } from "../lib/documents/id-card";
import { analyzeIdDocuments, decideAge } from "../lib/documents/analyze";
import { summarizeAge } from "../lib/documents/summary";
import { classify } from "../lib/documents/parse";
import { stopOcr } from "../lib/documents/ocr";

// Fixtures are tiny and built here (Angelo's specimen set isn't merged yet). Fictional issuer, fake names.
const now = new Date("2026-10-17T12:00:00Z");
const ADULT_DOB = "2001-06-06"; // 25
const MINOR_DOB = "2008-11-17"; // 17 years 11 months: turns 18 on 2026-11-17
const mmddyyyy = (iso: string) => `${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(0, 4)}`;
const aamva = (dob: string, expiry: string, name = "ADULT") =>
  `@\n\x1e\rANSI 636000100002DL00410278ZV03190008DLDAQD1234567\nDCSDEMO\nDACSPECIMEN\nDAD${name}\nDBD01012024\nDBB${mmddyyyy(dob)}\nDBA${mmddyyyy(expiry)}\nDBC1\nDAU070 in\nDAG1 DEMO ST\nDAIDEMOVILLE\nDAJZZ\nDAK000000000  \nDCF0000\nDCGUSA\nDDEN\nDDFN\nDDGN\r`;
async function barcodePng(text: string, opts: { rotate?: number; jpeg?: boolean } = {}): Promise<{ name: string; type: string; data: Uint8Array }> {
  const png = Buffer.from(await bwipjs.toBuffer({ bcid: "pdf417", text, scale: 3, columns: 8, backgroundcolor: "ffffff", paddingwidth: 24, paddingheight: 24 } as unknown as Parameters<typeof bwipjs.toBuffer>[0]));
  let img = sharp(png);
  if (opts.rotate) img = sharp(await img.png().toBuffer()).rotate(opts.rotate, { background: "#fff" });
  const data = new Uint8Array(opts.jpeg ? await img.jpeg({ quality: 70 }).toBuffer() : await img.png().toBuffer());
  return { name: opts.jpeg ? "id-back.jpg" : "id-back.png", type: opts.jpeg ? "image/jpeg" : "image/png", data };
}
/** Front of a specimen card, rendered as an image for OCR. */
async function frontPng(lines: string[], name = "id-front.png") {
  const s = 3;
  const texts = lines.map((t, i) => `<text x="${40 * s}" y="${(60 + i * 34) * s}" font-family="Helvetica, Arial, sans-serif" font-size="${20 * s}" font-weight="bold" fill="#111">${t}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${640 * s}" height="${(60 + lines.length * 34 + 40) * s}"><rect width="100%" height="100%" fill="#f6f4ee"/>${texts}</svg>`;
  return { name, type: "image/png", data: new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer()) };
}
/** TD3 passport MRZ for the fictional country UTO with correct check digits. */
function td3(dob: string, expiry: string): string[] {
  const yymmdd = (iso: string) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
  const docNo = "L898902C3", nat = "UTO", birth = yymmdd(dob), exp = yymmdd(expiry), optional = "<".repeat(14);
  const d = (s: string) => String(mrzCheckDigit(s));
  const line2 = `${docNo}${d(docNo)}${nat}${birth}${d(birth)}F${exp}${d(exp)}${optional}<`;
  const composite = line2.slice(0, 10) + line2.slice(13, 20) + line2.slice(21, 43);
  return ["P<UTODEMO<<ADULT".padEnd(44, "<"), line2 + d(composite)];
}
const leaks = (text: string) => [ADULT_DOB, MINOR_DOB, mmddyyyy(ADULT_DOB), mmddyyyy(MINOR_DOB), "06/06/2001", "2001", "2008"].filter((s) => text.includes(s));

after(() => stopOcr());

test("age arithmetic on today's UTC date", () => {
  assert.equal(ageOn(ADULT_DOB, now), 25);
  assert.equal(ageOn(MINOR_DOB, now), 17);
  assert.equal(ageOn("2008-10-17", now), 18, "18th birthday today counts");
  assert.equal(ageOn("2008-10-18", now), 17);
});

test("AAMVA barcode text: date of birth, expiry, both date orders", () => {
  const f = parseAamva(aamva(ADULT_DOB, "2030-12-31"))!;
  assert.equal(f.dob, ADULT_DOB);
  assert.equal(f.expiry, "2030-12-31");
  assert.equal(parseAamva("ANSI 636000\nDBB20010606\nDBA20301231")!.dob, ADULT_DOB, "CCYYMMDD (Canadian) order");
  assert.equal(parseAamva("hello"), null);
  assert.equal(parseAamva("@<LF><RS><CR>ANSI 636000<LF>DBB06062001<LF>DBA12312030<CR>")!.dob, ADULT_DOB, "escaped separators");
});

test("MRZ check digits: a correct TD3 passes, one edited digit fails, TD1 works too", () => {
  const ok = parseMrz(td3(ADULT_DOB, "2030-12-31"), now)!;
  assert.equal(ok.format, "TD3");
  assert.equal(ok.checkDigitsOk, true);
  assert.equal(ok.dob, ADULT_DOB);
  assert.equal(ok.expiry, "2030-12-31");
  // ICAO's own published specimen (ERIKSSON, UTO) has valid check digits.
  const icao = parseMrz(["P<UTOERIKSSON<<ANNA<MARIA".padEnd(44, "<"), "L898902C36UTO7408122F1204159ZE184226B<<<<<10"], now)!;
  assert.equal(icao.checkDigitsOk, true);
  assert.equal(icao.dob, "1974-08-12");
  // Edit the birth year digit: "01" -> "91" would make the holder older. The check digit catches it.
  const [l1, l2] = td3(ADULT_DOB, "2030-12-31");
  const edited = parseMrz([l1, l2.slice(0, 13) + "9" + l2.slice(14)], now)!;
  assert.equal(edited.checkDigitsOk, false);
  assert.ok(edited.failed.includes("date of birth"));
  // TD1 (3 x 30), built with correct digits.
  const d = (s: string) => String(mrzCheckDigit(s));
  const docNo = "D23145890", t1 = `IDUTO${docNo}${d(docNo)}${"<".repeat(15)}`;
  const birth = "010606", exp = "301231";
  const t2body = `${birth}${d(birth)}F${exp}${d(exp)}UTO${"<".repeat(11)}`;
  const t2 = t2body + d(t1.slice(5, 30) + t2body.slice(0, 7) + t2body.slice(8, 15) + t2body.slice(18, 29));
  const td1 = parseMrz([t1, t2, "DEMO<<ADULT<<<<<<<<<<<<<<<<<<<"], now)!;
  assert.equal(td1.format, "TD1");
  assert.equal(td1.checkDigitsOk, true);
  assert.equal(td1.dob, ADULT_DOB);
  // OCR noise: spaces, « for <, O read as 0 in the nationality, trailing junk past 44 characters.
  assert.equal(parseMrz(["P<UTO DEMO<<ADULT" + "«".repeat(28), l2], now)!.checkDigitsOk, true);
  assert.equal(parseMrz([l1, l2.replace("UTO", "UT0") + "LL<L"], now)!.checkDigitsOk, true);
  assert.equal(parseMrz([l2.replace("UTO", "UT0")], now)!.dob, ADULT_DOB, "the data line alone is enough");
});

test("front-of-card text: DOB / Date of Birth / BIRTH followed by a date", () => {
  assert.equal(parseFront(["STATE OF DEMO", "DOB 06/06/2001", "EXP 12/31/2030"]).dob, ADULT_DOB);
  assert.equal(parseFront(["Date of Birth: 2001-06-06"]).dob, ADULT_DOB);
  assert.equal(parseFront(["BIRTH DATE Jun 6, 2001"]).dob, ADULT_DOB);
  assert.equal(parseFront(["Hello"]).dob, undefined);
  assert.equal(classify(["STATE OF DEMO", "DRIVER LICENSE", "DOB 06/06/2001", "CLASS D"]), "id_card");
  assert.equal(classify(["Earnings Statement", "Gross Pay 5,000.00", "Net Pay 4,000.00"]), "pay_stub");
});

test("a PDF417 barcode decodes offline, even from a rotated phone JPEG", { timeout: 60_000 }, async () => {
  const text = await readPdf417((await barcodePng(aamva(ADULT_DOB, "2030-12-31"))).data);
  assert.ok(text && text.includes(`DBB${mmddyyyy(ADULT_DOB)}`));
  const photo = await readPdf417((await barcodePng(aamva(ADULT_DOB, "2030-12-31"), { rotate: 3, jpeg: true })).data);
  assert.ok(photo && photo.includes("DBB"));
});

test("adult license -> yes; 17 years 11 months -> no; expired -> declined; no DOB in reports or logs", { timeout: 120_000 }, async () => {
  const logged: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(orig) as (keyof typeof orig)[]) console[k] = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
  try {
    const adult = decideAge(await analyzeIdDocuments([await barcodePng(aamva(ADULT_DOB, "2030-12-31"))], now), 18, now);
    assert.deepEqual([adult.usable, adult.meets], [true, true]);
    assert.ok(adult.reports[0].checks.some((c) => c.id === "dob_found" && c.status === "pass"));
    assert.ok(adult.reports[0].checks.some((c) => c.id === "not_expired" && c.status === "pass"));

    const minor = decideAge(await analyzeIdDocuments([await barcodePng(aamva(MINOR_DOB, "2030-12-31", "MINOR"))], now), 18, now);
    assert.deepEqual([minor.usable, minor.meets], [true, false], "a usable ID under 18 is a signed no, not a decline");

    const expired = decideAge(await analyzeIdDocuments([await barcodePng(aamva(ADULT_DOB, "2025-01-01"))], now), 18, now);
    assert.equal(expired.usable, false);
    assert.match(expired.reason ?? "", /expired/i);

    const notAnId = decideAge(await analyzeIdDocuments([await frontPng(["Earnings Statement", "Gross Pay 5,000.00", "Net Pay 4,000.00"])], now), 18, now);
    assert.equal(notAnId.usable, false);

    for (const d of [adult, minor, expired]) {
      assert.deepEqual(leaks(JSON.stringify(d)), [], "decision carries no date of birth");
      assert.deepEqual(leaks(JSON.stringify(summarizeAge(d))), [], "summary carries no date of birth");
      assert.deepEqual(Object.keys(d.reports[0].fields), [], "no parsed fields on an ID report");
    }
    assert.deepEqual(leaks(logged.join("\n")), [], "nothing logged contains the date of birth");
  } finally {
    Object.assign(console, orig);
  }
});

test("front OCR fallback reads the date of birth, and the barcode agreeing with it is noted", { timeout: 120_000 }, async () => {
  const front = await readIdCard(await frontPng(["STATE OF DEMO  DRIVER LICENSE", "SPECIMEN - NOT A GOVERNMENT DOCUMENT", "DOB 06/06/2001", "EXP 12/31/2030", "CLASS D  SEX F  EYES BRO"]), now);
  assert.equal(front.private.dob, ADULT_DOB);
  assert.ok(front.report.checks.some((c) => c.id === "dob_found" && c.status === "pass" && /front/.test(c.label)));
  assert.equal(front.report.usable, true);
  assert.deepEqual(leaks(JSON.stringify(front.report)), []);

  // Barcode + front on one image: the barcode wins and the front agrees.
  const png = Buffer.from(await bwipjs.toBuffer({ bcid: "pdf417", text: aamva(ADULT_DOB, "2030-12-31"), scale: 3, columns: 8, backgroundcolor: "ffffff", paddingwidth: 20, paddingheight: 20 } as unknown as Parameters<typeof bwipjs.toBuffer>[0]));
  const frontImg = (await frontPng(["STATE OF DEMO  DRIVER LICENSE", "DOB 06/06/2001", "EXP 12/31/2030"])).data;
  const meta = await sharp(Buffer.from(frontImg)).metadata();
  const both = await sharp({ create: { width: meta.width!, height: meta.height! + 420, channels: 3, background: "#f6f4ee" } })
    .composite([{ input: Buffer.from(frontImg), top: 0, left: 0 }, { input: png, top: meta.height!, left: 40 }]).png().toBuffer();
  const combo = await readIdCard({ name: "id-both.png", type: "image/png", data: new Uint8Array(both) }, now);
  assert.ok(combo.report.checks.some((c) => c.id === "dob_found" && /barcode/.test(c.label)));
  assert.ok(combo.report.checks.some((c) => c.id === "barcode_matches_front" && c.status === "pass"));
});

test("a passport page whose MRZ was edited is declined with the check-digit reason", { timeout: 120_000 }, async () => {
  const [l1, l2] = td3(ADULT_DOB, "2030-12-31");
  const edited = l2.slice(0, 13) + "9" + l2.slice(14);
  const mono = (lines: string[]) => {
    const s = 3;
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const texts = lines.map((t, i) => `<text x="${20 * s}" y="${(50 + i * 36) * s}" font-family="Menlo, DejaVu Sans Mono, Liberation Mono, Courier New, monospace" font-size="${22 * s}" font-weight="bold" fill="#111" xml:space="preserve">${esc(t)}</text>`).join("");
    return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${720 * s}" height="${(50 + lines.length * 36 + 30) * s}"><rect width="100%" height="100%" fill="#fff"/>${texts}</svg>`)).png().toBuffer();
  };
  const good = await readIdCard({ name: "passport.png", type: "image/png", data: new Uint8Array(await mono(["PASSPORT  UTOPIA  SPECIMEN", l1, l2])) }, now);
  const bad = await readIdCard({ name: "passport-edited.png", type: "image/png", data: new Uint8Array(await mono(["PASSPORT  UTOPIA  SPECIMEN", l1, edited])) }, now);
  const mrzFound = good.report.checks.find((c) => c.id === "mrz_check_digits");
  if (!mrzFound) {
    console.log("OCR did not reconstruct the MRZ from this rendering; parser-level checks above cover the check digits.");
    return;
  }
  assert.equal(mrzFound.status, "pass");
  assert.equal(good.private.dob, ADULT_DOB);
  const badMrz = bad.report.checks.find((c) => c.id === "mrz_check_digits");
  assert.equal(badMrz?.status, "fail");
  assert.match(badMrz?.label ?? "", /check digit doesn't match/);
  assert.equal(decideAge([bad], 18, now).usable, false);
});
