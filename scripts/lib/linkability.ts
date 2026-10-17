export type Payload = Record<string, unknown>;
export type Classification = "same for everyone" | "different per landlord" | "LINKING";
export interface FieldAudit {
  field: string;
  classification: Classification;
  distinctA: number;
  distinctB: number;
  sharedValues: number;
}

/** Flatten all leaves, including array elements and empty containers. */
export function flattenPayload(payload: Payload): Record<string, string> {
  const result: Record<string, string> = {};
  function walk(value: unknown, path: string) {
    if (value !== null && typeof value === "object" && Object.keys(value).length) {
      for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key);
    } else {
      result[path] = JSON.stringify(value) ?? "undefined";
    }
  }
  for (const [key, value] of Object.entries(payload)) walk(value, key);
  return result;
}

function prepare(a: Payload[], b: Payload[]) {
  if (!a.length || a.length !== b.length) throw new Error("Expected equally sized, nonempty landlord datasets");
  const left = a.map(flattenPayload);
  const right = b.map(flattenPayload);
  const fields = [...new Set([...left, ...right].flatMap(Object.keys))].sort();
  return { left, right, fields };
}

const valueAt = (row: Record<string, string>, field: string) => row[field] ?? "<missing>";

/** No tenant identities or ground truth enter the audit. Shared varying values are potential links. */
export function auditFields(a: Payload[], b: Payload[]): FieldAudit[] {
  const { left, right, fields } = prepare(a, b);
  return fields.map((field) => {
    const av = new Set(left.map((row) => valueAt(row, field)));
    const bv = new Set(right.map((row) => valueAt(row, field)));
    const sharedValues = [...av].filter((value) => bv.has(value)).length;
    const classification: Classification = av.size === 1 && bv.size === 1
      ? (sharedValues ? "same for everyone" : "different per landlord")
      : sharedValues ? "LINKING" : "different per landlord";
    return { field, classification, distinctA: av.size, distinctB: bv.size, sharedValues };
  });
}

// Reproducible simulation randomness, NOT cryptography. Secrets use node:crypto instead.
function randomSource(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function shuffle<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Attacker sees payloads only. Score equality on EVERY nonconstant field, then
 * make one-to-one matches with shuffled order and random tie breaks. Numeric
 * distance/lexical proximity of HMAC subjects is not evidence of common identity.
 * Multiple trials avoid reporting a lucky/unlucky single random permutation.
 */
export function matchClaims(a: Payload[], b: Payload[], options: { trials?: number; seed?: number; excludeFields?: string[] } = {}) {
  const { left, right, fields } = prepare(a, b);
  const trials = options.trials ?? 1000;
  if (!Number.isInteger(trials) || trials < 1) throw new Error("trials must be a positive integer");
  const usedFields = fields.filter((field) => !options.excludeFields?.includes(field)
    && new Set([...left, ...right].map((row) => valueAt(row, field))).size > 1);
  const scores = left.map((row) => right.map((other) => usedFields.reduce(
    (score, field) => score + Number(valueAt(row, field) === valueAt(other, field)), 0,
  )));
  const random = randomSource(options.seed ?? 2026);
  const indices = left.map((_, i) => i);
  const assignments: number[][] = [];
  for (let trial = 0; trial < trials; trial++) {
    const available = new Set(indices);
    const matches = Array<number>(left.length);
    for (const i of shuffle(indices, random)) {
      const candidates = shuffle([...available], random);
      let best = candidates[0];
      for (const j of candidates) if (scores[i][j] > scores[i][best]) best = j;
      matches[i] = best;
      available.delete(best);
    }
    assignments.push(matches);
  }
  return { assignments, usedFields };
}

/** Ground truth is supplied ONLY after the attacker has returned its matches. */
export function scoreMatches(assignments: number[][], truthA: string[], truthB: string[]): number {
  if (!assignments.length || !truthA.length || truthA.length !== truthB.length) throw new Error("Expected matches and equally sized, nonempty ground truth");
  let correct = 0;
  for (const trial of assignments) {
    if (trial.length !== truthA.length || new Set(trial).size !== truthB.length
      || trial.some((j) => !Number.isInteger(j) || j < 0 || j >= truthB.length)) throw new Error("Expected a one-to-one assignment");
    correct += trial.filter((j, i) => truthA[i] === truthB[j]).length;
  }
  return correct / (assignments.length * truthA.length);
}

/** Three standard errors for uniform random permutations (upper bound only).
 * A permutation's number of correct matches has variance 1 for n >= 2.
 */
export function withinRandomNoise(accuracy: number, tenants: number, trials: number): boolean {
  if (!Number.isInteger(tenants) || tenants < 2 || !Number.isInteger(trials) || trials < 1) throw new Error("Expected at least two tenants and positive trials");
  const baseline = 1 / tenants;
  return accuracy <= baseline + 3 / (tenants * Math.sqrt(trials));
}
