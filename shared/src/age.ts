// Age claims: the fixed evidence every age answer carries. Owner: Sam.
// One value for every tenant (unlinkability rule): the claim says "a government ID was read on the
// device", never which document, which issuer, or anything about the date of birth.
import type { ClaimPayload } from "./types";

export const MIN_AGE = 18 as const;
export const AGE_METHOD = "government ID, date of birth";
export const AGE_WINDOW_DAYS = 0;
/** Every age claim carries exactly this. A forged photo can't be told from a real card, so it's never "verified". */
export const AGE_EVIDENCE: ClaimPayload["evidence"] = { source: "document", strength: "document_unverified", window_days: AGE_WINDOW_DAYS, method: AGE_METHOD };
