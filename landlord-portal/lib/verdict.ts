import type { EvidenceStrength, VerificationRequest } from "@ntk/shared";

function documentEvidence(evidence: EvidenceStrength | undefined): boolean {
  return evidence === "document_signed" || evidence === "document_bank_matched" || evidence === "document_unverified";
}

/** Words the landlord portal shows for a request. Document scans use accepted / declined. */
export function landlordVerdict(request: Pick<VerificationRequest, "status" | "expiresAt" | "result">): string {
  if (request.status === "pending" && Date.parse(request.expiresAt) <= Date.now()) return "Expired";
  if (request.status === "rejected") return "Declined";
  if (request.status === "verified" && request.result) {
    const fromDocument = documentEvidence(request.result.evidence);
    if (request.result.answer) return fromDocument ? "Accepted — meets the requirement" : "Yes — meets the requirement";
    return fromDocument ? "Declined" : "No — does not meet the requirement";
  }
  return "Waiting for the tenant";
}
