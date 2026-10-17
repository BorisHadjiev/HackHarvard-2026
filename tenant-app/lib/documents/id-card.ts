// Government ID reader for the age check. Owner: Sam. Everything here runs on this device.
//
// Sources, in order of trust:
//   1. PDF417 barcode on the back of a US driver's license / state ID (AAMVA): machine data.
//   2. Machine-readable zone of a passport (TD3) or ID card (TD1), read by OCR and verified with
//      the ICAO 9303 check digits: a hand-edited digit almost always breaks one.
//   3. The front of the card, OCR: "DOB" / "Date of Birth" / "BIRTH" followed by a date.
//
// Privacy: the date of birth and expiry date are returned in a separate `private` object that the
// callers keep in memory for the age decision only. The DocumentReport, every check label, every
// response and every log line carry only pass/fail and words. Never log anything from this file.
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { findRepoRoot } from "../build-hash";
import { extractDocument, extractPageImages, isImage, isPdf, prepareForOcr } from "./extract";
import { ocrMrzLines } from "./ocr";
import { tamperChecks } from "./tamper";
import { DATE_PATTERN, parseDate } from "./text";
import type { DocumentCheck, DocumentReport, ExtractedText, UploadedFile } from "./types";

/** What the age decision needs and the browser must never get. */
export interface IdPrivate {
  dob?: string; // YYYY-MM-DD
  expiry?: string; // YYYY-MM-DD
}
export interface IdReadResult {
  report: DocumentReport;
  private: IdPrivate;
}

const check = (id: string, status: DocumentCheck["status"], label: string): DocumentCheck => ({ id, status, label });

// ---------------------------------------------------------------- PDF417 / AAMVA

const g = globalThis as unknown as { __ntkZxing?: Promise<typeof import("zxing-wasm/reader")> };
/** zxing-wasm, with its .wasm read from node_modules so nothing is ever fetched from a CDN. */
async function zxing() {
  g.__ntkZxing ??= (async () => {
    const mod = await import("zxing-wasm/reader");
    // Same rule as the OCR model: the wasm comes from node_modules on this machine, never a download.
    const wasmPath = path.join(findRepoRoot(), "node_modules", "zxing-wasm", "dist", "reader", "zxing_reader.wasm");
    const wasmBinary = readFileSync(/*turbopackIgnore: true*/ wasmPath);
    // `wasmBinary` is an Emscripten option the library passes through but doesn't type.
    const overrides = { wasmBinary, locateFile: (file: string, prefix: string) => (file.endsWith(".wasm") ? wasmPath : prefix + file) } as unknown as Parameters<typeof mod.setZXingModuleOverrides>[0];
    mod.prepareZXingModule({ overrides, fireImmediately: true });
    return mod;
  })();
  return g.__ntkZxing;
}

/** Decode a PDF417 barcode from an image (PNG/JPEG/WebP bytes). Returns its text, or null. */
export async function readPdf417(image: Uint8Array): Promise<string | null> {
  const { readBarcodes } = await zxing();
  for (const variant of [image, await prepareForOcr(image)]) {
    try {
      const { data, info } = await sharp(Buffer.from(variant)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
      // Once the OCR engine has loaded, a global ImageData class exists and zxing checks `instanceof`, so build a real one when we can.
      const imageData = typeof ImageData !== "undefined" ? new ImageData(pixels, info.width, info.height) : ({ data: pixels, width: info.width, height: info.height } as ImageData);
      // textMode "Plain": AAMVA uses control characters (LF, RS, CR) as separators; the default mode prints them as "<LF>".
      const results = await readBarcodes(imageData, { formats: ["PDF417"], tryHarder: true, tryRotate: true, tryInvert: true, textMode: "Plain" });
      const hit = results.find((r) => r.text);
      if (process.env.NTK_ID_DEBUG) console.error("[id-card] pdf417 attempt:", info.width, "x", info.height, "results", results.length, "hit", !!hit);
      if (hit) return hit.text;
    } catch (err) {
      if (process.env.NTK_ID_DEBUG) console.error("[id-card] pdf417 variant failed:", (err as Error).message);
    }
  }
  return null;
}

export interface AamvaFields {
  dob?: string;
  expiry?: string;
  /** Issuing jurisdiction code (DAJ) or IIN. Never leaves this file. */
  issuer?: string;
}

/** AAMVA dates: US jurisdictions print MMDDCCYY, Canadian ones CCYYMMDD. */
function aamvaDate(raw: string | undefined): string | undefined {
  if (!raw || !/^\d{8}$/.test(raw)) return undefined;
  const a = Number(raw.slice(0, 4));
  const iso = a >= 1900 && a <= 2100
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
    : `${raw.slice(4, 8)}-${raw.slice(0, 2)}-${raw.slice(2, 4)}`;
  return parseDate(iso);
}

/** Pull DBB (birth), DBA (expiry) and DAJ (jurisdiction) out of AAMVA barcode text. */
export function parseAamva(raw: string): AamvaFields | null {
  // Some decoders print separators as tokens; map them back to the characters AAMVA specifies.
  const text = raw.replace(/<LF>/g, "\n").replace(/<CR>/g, "\r").replace(/<RS>/g, "\x1e").replace(/<GS>/g, "\x1d");
  if (!/ANSI |AAMVA/.test(text)) return null;
  const field = (code: string) => new RegExp(`(?:^|[\\n\\r\\x1e\\x1d])${code}([^\\n\\r\\x1e\\x1d]*)`).exec(text)?.[1]?.trim();
  const iin = /ANSI (\d{6})/.exec(text)?.[1];
  return { dob: aamvaDate(field("DBB")), expiry: aamvaDate(field("DBA")), issuer: field("DAJ") || iin };
}

// ---------------------------------------------------------------- MRZ (ICAO 9303)

const MRZ_WEIGHTS = [7, 3, 1];
function mrzValue(ch: string): number {
  if (ch === "<") return 0;
  if (ch >= "0" && ch <= "9") return ch.charCodeAt(0) - 48;
  if (ch >= "A" && ch <= "Z") return ch.charCodeAt(0) - 55;
  return -1;
}
/** ICAO 9303 check digit: weights 7,3,1 repeating, mod 10. */
export function mrzCheckDigit(s: string): number {
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const v = mrzValue(s[i]);
    if (v < 0) return -1;
    sum += v * MRZ_WEIGHTS[i % 3];
  }
  return sum % 10;
}
const checkOk = (data: string, digit: string) => /^\d$/.test(digit) && mrzCheckDigit(data) === Number(digit);

/** YYMMDD from an MRZ into YYYY-MM-DD. Birth dates: YY > current YY means 19YY. Expiry: always 20YY. */
function mrzDate(yymmdd: string, kind: "birth" | "expiry", now: Date): string | undefined {
  if (!/^\d{6}$/.test(yymmdd)) return undefined;
  const yy = Number(yymmdd.slice(0, 2));
  const nowYY = now.getUTCFullYear() % 100;
  const century = kind === "expiry" ? 2000 : yy > nowYY ? 1900 : 2000;
  return parseDate(`${century + yy}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`);
}

export interface MrzResult {
  format: "TD3" | "TD1";
  dob?: string;
  expiry?: string;
  /** Every check digit (document number, birth, expiry, composite) matched. */
  checkDigitsOk: boolean;
  failed: string[];
}

/** OCR text to MRZ characters: uppercase, no spaces, common misreads of the filler mapped back to '<'. */
function normalizeMrzLine(line: string): string {
  return line.toUpperCase().replace(/[«‹›»]/g, "<").replace(/[^A-Z0-9<]/g, "");
}

// Every MRZ position is known to hold a letter or a digit, so OCR confusions can be undone by
// position (the classic O/0, I/1, S/5, B/8, Z/2 pairs). The check digits then decide if it's right.
const TO_DIGIT: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", B: "8", G: "6" };
const TO_ALPHA: Record<string, string> = { "0": "O", "1": "I", "2": "Z", "5": "S", "8": "B", "6": "G" };
type Cls = "d" | "a" | "x"; // digit, alpha, anything
function fixByClass(s: string, classes: Cls[]): string {
  let out = "";
  for (let i = 0; i < classes.length; i++) {
    const ch = s[i] ?? "<";
    out += classes[i] === "d" ? (TO_DIGIT[ch] ?? ch) : classes[i] === "a" ? (ch === "<" ? ch : TO_ALPHA[ch] ?? ch) : ch;
  }
  return out;
}
const rep = (c: Cls, n: number): Cls[] => Array<Cls>(n).fill(c);
// TD3 line 2: doc no(9) cd | nationality(3) | birth(6) cd | sex | expiry(6) cd | optional(14) cd | composite
// The optional-data check digit (position 43) is '<' when that field is empty, so it stays "x".
const TD3_L2: Cls[] = [...rep("x", 9), "d", ...rep("a", 3), ...rep("d", 7), "a", ...rep("d", 7), ...rep("x", 14), "x", "d"];
const TD3_L2_SHAPE = /^[A-Z0-9<]{9}\d[A-Z<]{3}\d{7}[MF<X]\d{7}[A-Z0-9<]{14}[\d<]\d$/;
// TD1 line 1: doc type(2) issuer(3) doc no(9) cd optional(15); line 2: birth(6) cd sex expiry(6) cd nationality(3) optional(11) composite
const TD1_L1: Cls[] = [...rep("a", 2), ...rep("a", 3), ...rep("x", 9), "d", ...rep("x", 15)];
const TD1_L2: Cls[] = [...rep("d", 7), "a", ...rep("d", 7), ...rep("a", 3), ...rep("x", 11), "d"];
const TD1_L2_SHAPE = /^\d{7}[MF<X]\d{7}[A-Z<]{3}[A-Z0-9<]{11}\d$/;

/** Find and verify a TD3 (2 x 44) or TD1 (3 x 30) MRZ among OCR lines. */
export function parseMrz(lines: string[], now = new Date()): MrzResult | null {
  const norm = lines.map(normalizeMrzLine);
  for (let i = 0; i < norm.length; i++) {
    // TD3: the data line is self-contained; the name line above it carries no check digits.
    if (norm[i].length >= 44) {
      const l2 = fixByClass(norm[i].slice(0, 44), TD3_L2);
      if (TD3_L2_SHAPE.test(l2)) {
        const failed: string[] = [];
        const docNo = l2.slice(0, 9), docCd = l2[9];
        const birth = l2.slice(13, 19), birthCd = l2[19];
        const expiry = l2.slice(21, 27), expiryCd = l2[27];
        const optional = l2.slice(28, 42), optionalCd = l2[42];
        const composite = l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43), compositeCd = l2[43];
        if (!checkOk(docNo, docCd)) failed.push("document number");
        if (!checkOk(birth, birthCd)) failed.push("date of birth");
        if (!checkOk(expiry, expiryCd)) failed.push("expiry date");
        if (!(optionalCd === "<" && /^<+$/.test(optional)) && !checkOk(optional, optionalCd)) failed.push("optional data");
        if (!checkOk(composite, compositeCd)) failed.push("composite");
        return { format: "TD3", dob: mrzDate(birth, "birth", now), expiry: mrzDate(expiry, "expiry", now), checkDigitsOk: failed.length === 0, failed };
      }
    }
    // TD1: three 30-character lines; the second holds the dates.
    if (i + 2 < norm.length && norm[i].length >= 30 && norm[i + 1].length >= 30 && norm[i + 2].length >= 30) {
      const l1 = fixByClass(norm[i].slice(0, 30), TD1_L1);
      const l2 = fixByClass(norm[i + 1].slice(0, 30), TD1_L2);
      if (/^[A-Z<]{2}[A-Z<]{3}/.test(l1) && TD1_L2_SHAPE.test(l2)) {
        const failed: string[] = [];
        const docNo = l1.slice(5, 14), docCd = l1[14];
        const birth = l2.slice(0, 6), birthCd = l2[6];
        const expiry = l2.slice(8, 14), expiryCd = l2[14];
        const composite = l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29), compositeCd = l2[29];
        if (!checkOk(docNo, docCd)) failed.push("document number");
        if (!checkOk(birth, birthCd)) failed.push("date of birth");
        if (!checkOk(expiry, expiryCd)) failed.push("expiry date");
        if (!checkOk(composite, compositeCd)) failed.push("composite");
        return { format: "TD1", dob: mrzDate(birth, "birth", now), expiry: mrzDate(expiry, "expiry", now), checkDigitsOk: failed.length === 0, failed };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- front of card, OCR

const FRONT_DOB = new RegExp(String.raw`(?:\bDOB\b|date\s*of\s*birth|\bbirth(?:\s*date)?\b)\s*[:.\-]?\s*(${DATE_PATTERN})`, "i");
const FRONT_EXP = new RegExp(String.raw`(?:\bEXP(?:IRES|IRY|IRATION)?\b|\bexpiration\s*date\b)\s*[:.\-]?\s*(${DATE_PATTERN})`, "i");

export function parseFront(lines: string[]): { dob?: string; expiry?: string } {
  const text = lines.join("\n");
  const dob = FRONT_DOB.exec(text)?.[1];
  const exp = FRONT_EXP.exec(text)?.[1];
  return { dob: dob ? parseDate(dob) : undefined, expiry: exp ? parseDate(exp) : undefined };
}

// ---------------------------------------------------------------- the reader

/** Age in whole years on `now` (UTC), or undefined if the date is unusable. */
export function ageOn(dob: string, now: Date): number | undefined {
  const [y, m, d] = dob.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1;
  return age;
}

/**
 * Read one uploaded ID. The report never contains a date, a name or an issuer; `private` does and
 * must stay in memory.
 */
export async function readIdCard(file: UploadedFile, now = new Date()): Promise<IdReadResult> {
  const base = { fileName: file.name, readMethod: "pdf_text" as const, bankMatch: "not_checked" as const, signature: "none" as const, kind: "id_card" as const, fields: {} };
  const checks: DocumentCheck[] = [];
  const priv: IdPrivate = {};

  // 1. Text (and PDF tamper signals) through the existing pipeline. The lines never leave this function.
  let extracted: ExtractedText | undefined;
  try {
    extracted = await extractDocument(file, []);
  } catch (err) {
    return { report: { ...base, usable: false, checks: [check("read", "fail", (err as Error).message)] }, private: priv };
  }
  if (extracted.pdf) checks.push(...tamperChecks(extracted).checks.filter((c) => c.id !== "ocr"));

  // 2. Barcode: the original image, or the images inside a PDF.
  let barcode: AamvaFields | null = null;
  try {
    const images = isImage(file) ? [file.data] : isPdf(file) ? await extractPageImages(file.data) : [];
    for (const img of images) {
      const text = await readPdf417(img);
      const parsed = text ? parseAamva(text) : null;
      if (process.env.NTK_ID_DEBUG) console.error("[id-card] barcode text length:", text?.length ?? 0, "aamva parsed:", !!parsed, "has dob:", !!parsed?.dob);
      if (parsed?.dob) { barcode = parsed; break; }
    }
  } catch (err) {
    // No barcode is not an error; other sources may still work. (Debug aid: message only, never data.)
    if (process.env.NTK_ID_DEBUG) console.error("[id-card] barcode step failed:", (err as Error).message);
  }

  // 3. MRZ and front text from what was read. Images get a second, MRZ-only OCR pass when the
  //    first pass didn't yield a clean MRZ: the '<' filler confuses a normal text pass.
  let mrz = parseMrz(extracted.lines, now);
  if (!barcode && (!mrz || !mrz.checkDigitsOk)) {
    try {
      const images = isImage(file) ? [file.data] : isPdf(file) ? await extractPageImages(file.data) : [];
      for (const img of images) {
        const lines = await ocrMrzLines(await prepareForOcr(img));
        const second = parseMrz(lines, now);
        if (second && (second.checkDigitsOk || !mrz)) { mrz = second; break; }
      }
    } catch {
      // keep whatever the first pass found
    }
  }
  const front = parseFront(extracted.lines);

  // Pick the date of birth: barcode > MRZ (only if its check digits pass) > front text.
  let source: "barcode" | "mrz" | "front" | undefined;
  if (barcode?.dob) { priv.dob = barcode.dob; priv.expiry = barcode.expiry; source = "barcode"; }
  else if (mrz?.dob && mrz.checkDigitsOk) { priv.dob = mrz.dob; priv.expiry = mrz.expiry; source = "mrz"; }
  else if (front.dob) { priv.dob = front.dob; priv.expiry = front.expiry; source = "front"; }
  if (!priv.expiry) priv.expiry = barcode?.expiry ?? (mrz?.checkDigitsOk ? mrz.expiry : undefined) ?? front.expiry;

  const recognized = !!barcode || !!mrz || !!front.dob || /(driver'?s? ?licen[sc]e|identification card|passport)/i.test(extracted.lines.join("\n"));
  if (!recognized) checks.push(check("kind", "fail", "Not a government ID (no barcode, machine-readable zone or date of birth found)"));

  checks.push(priv.dob
    ? check("dob_found", "pass", source === "barcode" ? "Date of birth read from the barcode" : source === "mrz" ? "Date of birth read from the machine-readable zone" : "Date of birth read from the front of the card")
    : check("dob_found", "fail", "No date of birth could be read"));

  if (priv.dob) {
    const age = ageOn(priv.dob, now);
    checks.push(age !== undefined && age >= 0 && age < 120
      ? check("dob_plausible", "pass", "Date of birth is plausible")
      : check("dob_plausible", "fail", "Date of birth is in the future or implausibly old"));
  }

  if (priv.expiry) {
    checks.push(priv.expiry >= now.toISOString().slice(0, 10)
      ? check("not_expired", "pass", "ID has not expired")
      : check("not_expired", "fail", "ID has expired"));
  } else if (priv.dob) {
    checks.push(check("not_expired", "warn", "No expiry date could be read"));
  }

  if (mrz) {
    checks.push(mrz.checkDigitsOk
      ? check("mrz_check_digits", "pass", `Machine-readable zone check digits all match (${mrz.format})`)
      : check("mrz_check_digits", "fail", `Machine-readable zone check digit doesn't match for the ${mrz.failed.join(", ")}`));
  }

  if (barcode?.dob && front.dob) {
    checks.push(barcode.dob === front.dob
      ? check("barcode_matches_front", "pass", "Barcode and the front of the card agree")
      : check("barcode_matches_front", "warn", "Barcode and the front of the card give different dates of birth"));
  }

  const usable = !checks.some((c) => c.status === "fail");
  return {
    report: { ...base, readMethod: extracted.method, ocrConfidence: extracted.ocrConfidence, checks, usable },
    private: priv,
  };
}
