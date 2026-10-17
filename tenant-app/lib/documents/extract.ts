// Turn an uploaded file into text lines, on this device.
// Digital PDFs: positioned text (keeps columns apart). Scanned PDFs and photos: local OCR.
import sharp from "sharp";
import { extractImages, extractTextItems, getDocumentProxy, getMeta } from "unpdf";
import { ocrImage } from "./ocr";
import { verifyPdfSignatures } from "./pdf-signature";
import type { ExtractedText, PdfFacts, UploadedFile } from "./types";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 6;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function isPdf(file: UploadedFile): boolean {
  return file.type === "application/pdf" || Buffer.from(file.data.subarray(0, 5)).toString("latin1") === "%PDF-";
}
export function isImage(file: UploadedFile): boolean {
  return IMAGE_TYPES.has(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
}

/** Group positioned text items into lines (same baseline), left to right, top to bottom. */
function itemsToLines(items: { str: string; x: number; y: number; width: number }[]): string[] {
  const rows: { y: number; parts: { x: number; str: string; end: number }[] }[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const row = rows.find((r) => Math.abs(r.y - it.y) <= 2.5);
    const part = { x: it.x, str: it.str, end: it.x + it.width };
    if (row) row.parts.push(part);
    else rows.push({ y: it.y, parts: [part] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => {
      const parts = r.parts.sort((a, b) => a.x - b.x);
      let line = "";
      let lastEnd = -Infinity;
      for (const p of parts) {
        const gap = p.x - lastEnd;
        line += line ? (gap > 12 ? "   " : gap > 1.5 ? " " : "") : "";
        line += p.str;
        lastEnd = p.end;
      }
      return line.replace(/\s+$/, "");
    })
    .filter(Boolean);
}

function pdfDate(v: unknown): string | undefined {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  if (typeof v !== "string") return undefined;
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(v);
  if (!m) return undefined;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00"] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`).toISOString();
}

async function pdfFacts(data: Uint8Array, trusted: string[]): Promise<PdfFacts> {
  const raw = Buffer.from(data).toString("latin1");
  let info: Record<string, unknown> = {};
  try {
    info = (await getMeta(new Uint8Array(data), { parseDates: false })).info ?? {};
  } catch {
    // Metadata is optional; tamper checks just have less to go on.
  }
  return {
    producer: typeof info.Producer === "string" ? info.Producer : undefined,
    creator: typeof info.Creator === "string" ? info.Creator : undefined,
    creationDate: pdfDate(info.CreationDate),
    modDate: pdfDate(info.ModDate),
    eofCount: (raw.match(/%%EOF/g) ?? []).length,
    signatures: await verifyPdfSignatures(data, trusted),
  };
}

/** Convert raw pixels from a PDF image into PNG for OCR. */
async function pixelsToPng(img: { data: Uint8ClampedArray; width: number; height: number; channels: 1 | 3 | 4 }) {
  return new Uint8Array(await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: img.channels } }).png().toBuffer());
}

/** Upscale small photos and convert to grayscale: OCR reads 300 DPI-like text much better. */
async function prepareForOcr(image: Uint8Array): Promise<Uint8Array> {
  const img = sharp(Buffer.from(image)).rotate(); // honor EXIF orientation from phone cameras
  const meta = await img.metadata();
  const width = meta.width ?? 0;
  const scaled = width && width < 1600 ? img.resize({ width: 1600 }) : img;
  return new Uint8Array(await scaled.grayscale().normalize().png().toBuffer());
}

export async function extractDocument(file: UploadedFile, trustedSigners: string[]): Promise<ExtractedText> {
  if (isPdf(file)) {
    const facts = await pdfFacts(file.data, trustedSigners);
    const doc = await getDocumentProxy(new Uint8Array(file.data));
    const { items, totalPages } = await extractTextItems(doc);
    const pages = items.map((page) => itemsToLines(page));
    const lines = pages.flat();
    if (lines.join("").replace(/\s/g, "").length >= 40) return { lines, pages, method: "pdf_text", pdf: facts };

    // Scanned PDF: no text layer. OCR the page images (first 3 pages).
    const ocrPages: string[][] = [];
    const confidences: number[] = [];
    for (let p = 1; p <= Math.min(totalPages, 3); p++) {
      const pageLines: string[] = [];
      for (const img of await extractImages(doc, p)) {
        if (img.width < 300) continue;
        const res = await ocrImage(await prepareForOcr(await pixelsToPng(img)));
        pageLines.push(...res.lines);
        confidences.push(res.confidence);
      }
      ocrPages.push(pageLines);
    }
    const confidence = confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : 0;
    return { lines: ocrPages.flat(), pages: ocrPages, method: "pdf_ocr", ocrConfidence: confidence, pdf: facts };
  }
  if (isImage(file)) {
    const res = await ocrImage(await prepareForOcr(file.data));
    return { lines: res.lines, method: "image_ocr", ocrConfidence: res.confidence };
  }
  throw new Error("Unsupported file type. Use a PDF, PNG, JPEG or WebP.");
}
