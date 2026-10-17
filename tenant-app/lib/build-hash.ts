// Hash of the tenant app's own source code. Owner: Sam.
// Used by scripts/sign-manifest.ts (to approve a build) and lib/integrity.ts (to check it at runtime).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Everything that decides what the tenant app does: its code, and the shared signing code it imports. */
export const HASHED_DIRS = ["tenant-app/app", "tenant-app/lib", "shared/src"];
export const HASHED_FILES = ["tenant-app/next.config.ts", "tenant-app/package.json", "shared/package.json"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".json"]);
const HASH_VERSION = "ntk-build-v1";

export interface SourceHash {
  /** "sha256:<hex>" over every file's path and content hash, in sorted order. */
  hash: string;
  /** Repo-relative path -> sha256 hex of its content. */
  files: Record<string, string>;
}

/** Walk up from `start` to the folder that holds both tenant-app/ and shared/. */
export function findRepoRoot(start = process.cwd()): string {
  // turbopackIgnore: we read our own source at runtime on purpose; don't bundle the project for it.
  let dir = path.resolve(/*turbopackIgnore: true*/ start);
  for (;;) {
    if (existsSync(path.join(dir, "tenant-app")) && existsSync(path.join(dir, "shared"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Could not find the repo root (a folder with tenant-app/ and shared/) above ${start}`);
    dir = parent;
  }
}

function listFiles(root: string, rel: string): string[] {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const childRel = `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(root, childRel));
    else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) out.push(childRel);
  }
  return out;
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/** Hash the tenant app's source under `root` (the repo root). Deterministic: same files, same hash. */
export function hashSourceFiles(root: string): SourceHash {
  const paths = [...HASHED_DIRS.flatMap((d) => listFiles(root, d)), ...HASHED_FILES.filter((f) => existsSync(path.join(/*turbopackIgnore: true*/ root, f)))];
  const files: Record<string, string> = {};
  for (const rel of [...new Set(paths)].sort()) files[rel] = sha256(readFileSync(path.join(/*turbopackIgnore: true*/ root, rel)));
  const lines = Object.entries(files).map(([rel, h]) => `${rel}\t${h}\n`).join("");
  return { hash: `sha256:${sha256(`${HASH_VERSION}\n${lines}`)}`, files };
}

/** Which files differ between an approved file list and the current one (for a readable error). */
export function changedFiles(approved: Record<string, string>, current: Record<string, string>): string[] {
  const all = new Set([...Object.keys(approved), ...Object.keys(current)]);
  return [...all].filter((f) => approved[f] !== current[f]).sort();
}
