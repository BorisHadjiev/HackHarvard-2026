// Connect a real banking app through Plaid (sandbox by default). Owner: Sam.
// The tenant logs in to their bank inside Plaid Link; this app gets an access token that stays in
// this process's memory (never on disk, never sent to the landlord) and reads ~90 days of deposits.
import { randomUUID } from "node:crypto";
import type { Deposit } from "./nessie";

const HOSTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

export function plaidConfig() {
  const clientId = process.env.PLAID_CLIENT_ID ?? "";
  const secret = process.env.PLAID_SECRET ?? "";
  const env = process.env.PLAID_ENV ?? "sandbox";
  return { clientId, secret, env, host: HOSTS[env] ?? HOSTS.sandbox, configured: Boolean(clientId && secret) };
}

export class PlaidError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "PlaidError";
  }
}

type Fetch = typeof fetch;

async function plaidPost<T>(path: string, body: Record<string, unknown>, fetchImpl: Fetch = fetch): Promise<T> {
  const cfg = plaidConfig();
  if (!cfg.configured) throw new PlaidError("NOT_CONFIGURED", "Set PLAID_CLIENT_ID and PLAID_SECRET in tenant-app/.env.local");
  const res = await fetchImpl(`${cfg.host}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: cfg.clientId, secret: cfg.secret, ...body }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new PlaidError(String(json.error_code ?? res.status), String(json.error_message ?? `Plaid returned ${res.status}`));
  return json as T;
}

/** Step 1: a short-lived token that opens Plaid Link in the tenant's browser. */
export async function createLinkToken(fetchImpl?: Fetch): Promise<string> {
  const json = await plaidPost<{ link_token: string }>("/link/token/create", {
    client_name: "Janus",
    user: { client_user_id: randomUUID() }, // random per session: Plaid never learns who the tenant is to us
    products: ["transactions"],
    transactions: { days_requested: 90 },
    country_codes: ["US"],
    language: "en",
  }, fetchImpl);
  return json.link_token;
}

// Access tokens live only in this process's memory, keyed by a random id the browser holds.
type Link = { accessToken: string; institution?: string; createdAt: number };
const g = globalThis as unknown as { __ntkPlaid?: Map<string, Link> };
const links = (g.__ntkPlaid ??= new Map());
const LINK_TTL_MS = 60 * 60 * 1000;

/** Step 2: trade the public token from Plaid Link for an access token, kept in memory. */
export async function exchangePublicToken(publicToken: string, institution?: string, fetchImpl?: Fetch): Promise<string> {
  const json = await plaidPost<{ access_token: string }>("/item/public_token/exchange", { public_token: publicToken }, fetchImpl);
  for (const [id, l] of links) if (Date.now() - l.createdAt > LINK_TTL_MS) links.delete(id);
  const linkId = randomUUID();
  links.set(linkId, { accessToken: json.access_token, institution, createdAt: Date.now() });
  return linkId;
}

export function linkedInstitution(linkId: string): string | undefined {
  return links.get(linkId)?.institution;
}

interface PlaidTransaction { transaction_id: string; amount: number; date: string; name: string; merchant_name?: string | null; pending?: boolean }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Step 3: ~90 days of deposits. In Plaid, money coming in has a negative amount. */
export async function fetchPlaidDeposits(linkId: string, now = new Date(), fetchImpl?: Fetch, retryDelayMs = 1500): Promise<Deposit[]> {
  const link = links.get(linkId);
  if (!link) throw new PlaidError("LINK_EXPIRED", "The bank connection expired. Connect your bank again.");
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
  const all: PlaidTransaction[] = [];
  for (let attempt = 0; ; attempt++) {
    try {
      let total = Infinity;
      while (all.length < total) {
        const page = await plaidPost<{ transactions: PlaidTransaction[]; total_transactions: number }>("/transactions/get", {
          access_token: link.accessToken, start_date: start, end_date: end, options: { count: 500, offset: all.length },
        }, fetchImpl);
        all.push(...page.transactions);
        total = page.total_transactions;
        if (!page.transactions.length) break;
      }
      break;
    } catch (err) {
      // Right after linking, Plaid needs a few seconds to pull the history.
      if (err instanceof PlaidError && err.code === "PRODUCT_NOT_READY" && attempt < 8) {
        await sleep(retryDelayMs);
        continue;
      }
      throw err;
    }
  }
  return all
    .filter((t) => t.amount < 0 && !t.pending)
    .map((t) => ({ id: t.transaction_id, payer: t.merchant_name || t.name, amount: Math.round(-t.amount * 100) / 100, date: t.date }));
}

/** For tests. */
export function _resetPlaidLinks() {
  links.clear();
}
