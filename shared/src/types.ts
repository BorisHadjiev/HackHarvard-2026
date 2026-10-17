// Shared types for Need-to-Know. Owner: Sam. Announce changes in the group chat:
// both apps import from here.

/** What a landlord asks for. Only one claim type exists in the MVP. */
export type ClaimType = "income_to_rent"; // stretch: "age_over"

export interface IncomeToRentQuestion {
  type: "income_to_rent";
  /** Monthly rent in whole US dollars, e.g. 2400 */
  rent: number;
  /** Required income multiple, e.g. 3 means income >= 3x rent */
  multiple: number;
}

export type Question = IncomeToRentQuestion;

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
  result?: { answer: boolean; verifiedAt: string; evidence?: EvidenceStrength };
}

/** The body of the signed claim. Contains no dollar amounts or documents. */
export interface ClaimPayload {
  aud: string;
  nonce: string;
  /** Pairwise ID: different for every landlord, so landlords can't track a tenant */
  sub: string;
  claim: {
    type: ClaimType;
    multiple: number;
    rent: number;
    result: boolean;
  };
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
