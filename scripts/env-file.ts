// Update KEY=value lines in a .env.local file, keeping every other line.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

/** Set (or, with `undefined`, remove) the given keys. */
export function upsertEnv(path: string, values: Record<string, string | undefined>) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
  const kept = lines.filter((l) => !Object.keys(values).some((k) => l.startsWith(`${k}=`)));
  const added = Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`);
  writeFileSync(path, [...kept, ...added].join("\n") + "\n");
}
