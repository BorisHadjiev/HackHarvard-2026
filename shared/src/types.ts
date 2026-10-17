// Shared types for Need-to-Know. Owner: Sam. Announce changes in the group chat:
// both apps import from here.

/** What a landlord can ask for. */
export type ClaimType = "income_to_rent" | "age_over";

export interface IncomeToRentQuestion {
  type: "income_to_rent";
  /** Monthly rent in whole US dollars, e.g. 2400 */
  rent: number;
  /** Required income multiple, e.g. 3 means income >= 3x rent */
  multiple: number;
}

export interface AgeOverQuestion {
  type: "age_over";
  /** Only 18 in this build. A fixed set of thresholds keeps tenants in large, identical groups. */
  min_age: 18;
}

export type Question = IncomeToRentQuestion | AgeOverQuestion;

/**
 * The answer part of a signed claim. Each branch repeats the question so the portal can check the
 * answer matches what it asked. Never a dollar amount, a date of birth, an age, or a name.
 */
export type ClaimBody =
  | { type: "income_to_rent"; multiple: number; rent: number; result: boolean }
  | { type: "age_over"; min_age: 18; result: boolean };

/**
 * How the tenant's app established the answer, strongest first. Deliberately coarse: every extra
 * value splits tenants into smaller groups that pooled landlords could tell apart (collusion test).
 * - bank: computed from deposits pulled straight from the tenant's bank (Nessie, Plaid)
 * - document_signed: computed from documents carrying a valid digital signature from a trusted issuer
 * - document_bank_matched: computed from documents whose numbers matched the bank's own records
 * - document_unverified: computed from documents that passed the on-device tamper checks, but nothing
 *   independent confirmed them. A scan or photo alone can be edited, so this is the weakest level.
 */
export type EvidenceStrength = "bank" | "document_signed" | "document_bank_matched" | "document_unverified";

/** A verification request created on the landlord portal. */
export interface VerificationRequest {
  id: string;
  /** One-time code. A claim must echo it back, and it can be used once. */
  nonce: string;
  /** Who is asking, shown on the tenant's consent screen */
  requesterName: string;
  /** Audience the claim must be addressed to (the portal's id) */
  audience: string;
  question: Question;
  createdAt: string; // ISO date
  expiresAt: string; // ISO date; the request itself expires
  status: "pending" | "verified" | "rejected";
  /** Filled in once a claim is accepted. Never contains dollar amounts. */
  result?: { answer: boolean; verifiedAt: string; evidence?: EvidenceStrength; proof?: "zk" };
}

/** The body of the signed claim. Contains no dollar amounts or documents. */
export interface ClaimPayload {
  aud: string;
  nonce: string;
  /** Pairwise ID: different for every landlord, so landlords can't track a tenant */
  sub: string;
  claim: ClaimBody;
  evidence: {
    /** Where the numbers came from. Never the documents or deposits themselves. */
    source: "bank" | "document";
    /** How strongly the answer is backed. Claims from builds before this field count as "bank". */
    strength: EvidenceStrength;
    window_days: number;
    /** One fixed description per source (never per tenant), e.g. "recurring deposits, median month". */
    method: string;
  };
  build: {
    hash: string;
    integrity: "passed";
  };
}

export interface VerifiedClaim extends ClaimPayload {
  iat: number;
  exp: number;
}
