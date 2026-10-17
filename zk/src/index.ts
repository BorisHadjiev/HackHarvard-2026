// Zero-knowledge income proof: prove "income >= multiple x rent" over bank deposits without
// revealing them. Owner: Sam. Circuit: zk/circuit/src/main.nr (compiled into zk/artifacts/).
//
// Trust model: the proof shows the rule was applied correctly to the deposit list behind
// `commitment`. The BANK signs that commitment (see bank-signer/), so the tenant can neither
// invent deposits nor flip the answer. The landlord checks both: bank signature + proof.
import { createHash, randomBytes } from "node:crypto";
import { cpus } from "node:os";
import type { Barretenberg } from "@aztec/bb.js";
import { circuit, verificationKeyBase64 } from "../artifacts/income_to_rent";

export const MAX_DEPOSITS = 32;
export const WINDOW_DAYS = 90;
/** Day-based evaluation: last 90 days, payers seen 3+ times, median of three 30-day months. */
export const METHOD = "recurring deposits, median month, zero-knowledge proof";

export interface ZkDeposit {
  amountCents: number;
  /** Days since 1970-01-01 UTC. */
  day: number;
  /** Opaque payer id, same employer -> same id. See payerId(). */
  payer: bigint;
}

export interface IncomePublicInputs {
  commitment: string; // 0x-prefixed 32-byte hex
  today: number;
  rentCents: number;
  multipleX100: number;
  requestTag: string; // 0x-prefixed 32-byte hex
}

export interface IncomeProof {
  /** base64 proof bytes */
  proof: string;
  /** public inputs as the prover emitted them (ABI order, then the return value) */
  publicInputs: string[];
}

const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// ---------------------------------------------------------------- encoding helpers

export function dayNumber(isoDate: string): number {
  const t = Date.parse(isoDate.length === 10 ? `${isoDate}T00:00:00Z` : isoDate);
  if (Number.isNaN(t)) throw new Error(`bad date: ${isoDate}`);
  return Math.floor(t / 86_400_000);
}

/** 31-byte truncated SHA-256, as a field element (always < modulus). */
function fieldFromText(prefix: string, text: string): bigint {
  const h = createHash("sha256").update(`${prefix}:${text}`).digest();
  return BigInt(`0x${h.subarray(0, 31).toString("hex")}`);
}
export const payerId = (payerKey: string): bigint => fieldFromText("ntk-payer", payerKey.trim().toLowerCase());
export const requestTag = (nonce: string): string => fieldToHex(fieldFromText("ntk-request", nonce));

export function fieldToHex(v: bigint | number): string {
  const n = BigInt(v);
  if (n < 0n || n >= FIELD_MODULUS) throw new Error("value out of field range");
  return `0x${n.toString(16).padStart(64, "0")}`;
}
const fieldToBytes = (v: bigint | number) => Buffer.from(fieldToHex(v).slice(2), "hex");
const hexToBigint = (hex: string) => BigInt(hex);

/** A fresh salt for one request, as a field element. Keeps commitments unlinkable across landlords. */
export function newSalt(): bigint {
  return BigInt(`0x${randomBytes(31).toString("hex")}`);
}

/** The exact preimage the circuit hashes: [salt, count, amounts[32], days[32], payers[32]]. */
export function commitmentPreimage(deposits: ZkDeposit[], salt: bigint): bigint[] {
  if (deposits.length > MAX_DEPOSITS) throw new Error(`at most ${MAX_DEPOSITS} deposits can be proven`);
  const pad = <T,>(xs: T[], fill: T) => [...xs, ...Array(MAX_DEPOSITS - xs.length).fill(fill)];
  return [
    salt,
    BigInt(deposits.length),
    ...pad(deposits.map((d) => BigInt(d.amountCents)), 0n),
    ...pad(deposits.map((d) => BigInt(d.day)), 0n),
    ...pad(deposits.map((d) => d.payer), 0n),
  ];
}

// ---------------------------------------------------------------- Barretenberg

const g = globalThis as unknown as { __ntkBb?: Promise<Barretenberg> };
export async function barretenberg(): Promise<Barretenberg> {
  g.__ntkBb ??= (async () => {
    const { Barretenberg } = await import("@aztec/bb.js");
    return Barretenberg.new({ threads: Math.min(8, Math.max(1, cpus().length)) });
  })();
  return g.__ntkBb;
}

/** Pedersen hash of the salted deposit list, identical to the circuit's. The bank signs this. */
export async function commitDeposits(deposits: ZkDeposit[], salt: bigint): Promise<string> {
  const api = await barretenberg();
  const { hash } = await api.pedersenHash({ inputs: commitmentPreimage(deposits, salt).map(fieldToBytes), hashIndex: 0 });
  return `0x${Buffer.from(hash).toString("hex")}`;
}

// ---------------------------------------------------------------- artifacts

let vk: Uint8Array | undefined;
export function verificationKey(): Uint8Array {
  vk ??= new Uint8Array(Buffer.from(verificationKeyBase64, "base64"));
  return vk;
}
/** Hash of the verification key: identifies exactly which circuit a proof is for. */
export const circuitId = () => `sha256:${createHash("sha256").update(verificationKey()).digest("hex")}`;

// ---------------------------------------------------------------- prove / verify

export async function proveIncome(deposits: ZkDeposit[], salt: bigint, pub: IncomePublicInputs): Promise<IncomeProof & { result: boolean }> {
  const { Noir } = await import("@noir-lang/noir_js");
  const { UltraHonkBackend } = await import("@aztec/bb.js");
  const program = circuit as unknown as { bytecode: string };
  const pre = commitmentPreimage(deposits, salt);
  const inputs = {
    amounts: pre.slice(2, 34).map(String),
    days: pre.slice(34, 66).map(String),
    payers: pre.slice(66, 98).map((v) => fieldToHex(v)),
    count: deposits.length,
    salt: fieldToHex(salt),
    commitment: pub.commitment,
    today: pub.today,
    rent_cents: String(pub.rentCents),
    multiple_x100: pub.multipleX100,
    request_tag: pub.requestTag,
  };
  const { witness, returnValue } = await new Noir(program as never).execute(inputs);
  const backend = new UltraHonkBackend(program.bytecode, await barretenberg());
  const { proof, publicInputs } = await backend.generateProof(witness);
  const result = returnValue === true || (typeof returnValue === "string" && hexToBigint(returnValue) === 1n);
  return { proof: Buffer.from(proof).toString("base64"), publicInputs, result };
}

export type VerifyOutcome = { valid: true; result: boolean } | { valid: false; reason: string };

/**
 * Verify a proof AND that its public inputs are the ones the landlord expects. A valid proof
 * over different public inputs (another request, another rent, another deposit list) is worthless.
 */
export async function verifyIncomeProof(p: IncomeProof, expected: IncomePublicInputs): Promise<VerifyOutcome> {
  const want = [fieldToHex(hexToBigint(expected.commitment)), fieldToHex(expected.today), fieldToHex(expected.rentCents), fieldToHex(expected.multipleX100), fieldToHex(hexToBigint(expected.requestTag))];
  if (!Array.isArray(p.publicInputs) || p.publicInputs.length !== want.length + 1) return { valid: false, reason: "wrong number of public inputs" };
  const got = p.publicInputs.map((h) => { try { return fieldToHex(hexToBigint(h)); } catch { return "bad"; } });
  const names = ["commitment", "today", "rent", "multiple", "request"];
  for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) return { valid: false, reason: `proof is for a different ${names[i]}` };
  const resultField = got[want.length];
  if (resultField !== fieldToHex(0) && resultField !== fieldToHex(1)) return { valid: false, reason: "malformed result" };

  let proofBytes: Uint8Array;
  try {
    proofBytes = new Uint8Array(Buffer.from(String(p.proof), "base64"));
  } catch {
    return { valid: false, reason: "malformed proof" };
  }
  const { UltraHonkVerifierBackend } = await import("@aztec/bb.js");
  const verifier = new UltraHonkVerifierBackend(await barretenberg());
  let ok = false;
  try {
    ok = await verifier.verifyProof({ proof: proofBytes, publicInputs: p.publicInputs, verificationKey: verificationKey() } as never);
  } catch (err) {
    return { valid: false, reason: `proof did not verify: ${(err as Error).message}` };
  }
  if (!ok) return { valid: false, reason: "proof did not verify" };
  return { valid: true, result: resultField === fieldToHex(1) };
}
