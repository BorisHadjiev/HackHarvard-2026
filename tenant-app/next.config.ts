import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@ntk/shared"],
  // Load these from node_modules at runtime instead of bundling: OCR runs worker threads and reads its
  // model from disk, and the PDF reader ships its own worker.
  serverExternalPackages: ["tesseract.js", "tesseract.js-core", "@tesseract.js-data/eng", "unpdf", "sharp", "zxing-wasm"],
};

export default nextConfig;
