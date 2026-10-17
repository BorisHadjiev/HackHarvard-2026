// Request store. Owner: Sam.
// Saved to a JSON file (default landlord-portal/.data/store.json, git-ignored) so requests and
// used one-time codes survive a server restart. Kept on globalThis so Next.js hot reloads share one copy.
// Unlinkability rule: store only what's here today (requests and yes/no results). Never IPs, devices or dollar amounts.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { VerificationRequest } from "@ntk/shared";

export interface Store {
  requests: Map<string, VerificationRequest>;
  usedNonces: Set<string>;
  /**
   * Write to disk now. Adding/removing entries saves automatically at the end of the current tick;
   * call this after editing a request in place (e.g. setting its result) when it must be on disk before you reply.
   */
  save(): void;
}

interface StoreFile {
  version: 1;
  requests: VerificationRequest[];
  usedNonces: string[];
}

class AutoSaveMap<K, V> extends Map<K, V> {
  onChange = () => {};
  set(key: K, value: V) {
    super.set(key, value);
    this.onChange();
    return this;
  }
  delete(key: K) {
    const had = super.delete(key);
    if (had) this.onChange();
    return had;
  }
  clear() {
    super.clear();
    this.onChange();
  }
}

class AutoSaveSet<T> extends Set<T> {
  onChange = () => {};
  add(value: T) {
    const isNew = !this.has(value);
    super.add(value);
    if (isNew) this.onChange();
    return this;
  }
  delete(value: T) {
    const had = super.delete(value);
    if (had) this.onChange();
    return had;
  }
  clear() {
    super.clear();
    this.onChange();
  }
}

/** Open (or create) a store backed by `file`. */
export function openStore(file: string): Store {
  const requests = new AutoSaveMap<string, VerificationRequest>();
  const usedNonces = new AutoSaveSet<string>();

  if (existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as Partial<StoreFile>;
      for (const r of data.requests ?? []) requests.set(r.id, r);
      for (const n of data.usedNonces ?? []) usedNonces.add(n);
    } catch (err) {
      // Don't take the portal down over a bad file: keep a copy for debugging and start empty.
      const backup = `${file}.corrupt-${Date.now()}`;
      renameSync(file, backup);
      console.warn(`[store] ${file} was unreadable (${(err as Error).message}); moved it to ${backup} and started empty.`);
      requests.clear();
      usedNonces.clear();
    }
  }

  const save = () => {
    const data: StoreFile = { version: 1, requests: [...requests.values()], usedNonces: [...usedNonces] };
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file); // atomic replace: a crash mid-write never leaves half a file
  };

  // Coalesce saves: many changes in one tick (including in-place edits right after a set/add) become one write.
  let pending = false;
  const scheduleSave = () => {
    if (pending) return;
    pending = true;
    setImmediate(() => {
      pending = false;
      save();
    });
  };
  requests.onChange = scheduleSave;
  usedNonces.onChange = scheduleSave;

  return { requests, usedNonces, save };
}

export const STORE_FILE = process.env.PORTAL_STORE_FILE ?? path.join(process.cwd(), ".data", "store.json");

const g = globalThis as unknown as { __ntkStore?: Store };
export const store: Store = (g.__ntkStore ??= openStore(STORE_FILE));

/** What the tenant app is allowed to see about a request. */
export function publicView(r: VerificationRequest) {
  const { id, nonce, requesterName, audience, question, expiresAt, status } = r;
  return { id, nonce, requesterName, audience, question, expiresAt, status };
}
