// On-device OCR with tesseract.js. The English model ships in node_modules (@tesseract.js-data/eng),
// so recognizing a photo never downloads anything or sends the image anywhere.
import { createRequire } from "node:module";
import path from "node:path";
import { cleanOcrLine } from "./text";

type Worker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;
const g = globalThis as unknown as { __ntkOcr?: Promise<Worker> };
const OCR_TIMEOUT_MS = 60_000;

/** Fail cleanly instead of hanging the request if the OCR engine can't start or stalls. */
function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`On-device OCR timed out while ${what}`)), OCR_TIMEOUT_MS); }),
  ]);
}

function localLangPath(): string {
  const require = createRequire(import.meta.url);
  // 4.0.0 is the full-accuracy model; the package exposes it as `langPath`.
  return (require("@tesseract.js-data/eng") as { langPath: string }).langPath;
}

async function worker(): Promise<Worker> {
  g.__ntkOcr ??= (async () => {
    const { createWorker } = await import("tesseract.js");
    let failed: (err: unknown) => void = () => {};
    const startFailed = new Promise<never>((_, reject) => { failed = reject; });
    const w = await withTimeout(Promise.race([
      createWorker("eng", 1, {
        langPath: localLangPath(),
        gzip: true,
        cacheMethod: "none", // read the model from disk every start; never write a cache file
        errorHandler: (err: unknown) => failed(new Error(`On-device OCR failed to start: ${String(err)}`)),
      }),
      startFailed,
    ]), "starting");
    await w.setParameters({ preserve_interword_spaces: "1" });
    return w;
  })().catch((err) => {
    g.__ntkOcr = undefined;
    throw err;
  });
  return g.__ntkOcr;
}

/** OCR an image (PNG/JPEG/WebP bytes). Returns cleaned lines and mean confidence (0-100). */
export async function ocrImage(image: Uint8Array): Promise<{ lines: string[]; confidence: number }> {
  const w = await worker();
  const { data } = await withTimeout(w.recognize(Buffer.from(image)), "reading the image");
  const lines = data.text.split("\n").map(cleanOcrLine).filter(Boolean);
  return { lines, confidence: Math.round(data.confidence) };
}

export async function stopOcr() {
  const w = g.__ntkOcr;
  g.__ntkOcr = undefined;
  if (w) await (await w).terminate();
}

export const OCR_MODEL_PATH = () => path.relative(process.cwd(), localLangPath());
