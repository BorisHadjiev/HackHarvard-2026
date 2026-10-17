// Verify digital signatures embedded in a PDF (the kind banks, payroll providers and e-signing
// tools add). Uses PKI.js for the CMS/PKCS#7 structure and WebCrypto for the math: no hand-rolled crypto.
// "Trusted" means the signer certificate's SHA-256 fingerprint is in TRUSTED_DOCUMENT_SIGNERS.
// Production would instead check the certificate chain against issuer roots (e.g. Adobe AATL).
import { createHash, webcrypto } from "node:crypto";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import type { SignatureFacts } from "./types";

let engineSet = false;
function ensureEngine() {
  if (engineSet) return;
  pkijs.setEngine("node-webcrypto", new pkijs.CryptoEngine({ name: "node-webcrypto", crypto: webcrypto as unknown as Crypto }));
  engineSet = true;
}

const CN_OID = "2.5.4.3";
const ORG_OID = "2.5.4.10";

function signerName(cert: pkijs.Certificate): string | undefined {
  const attrs = cert.subject.typesAndValues;
  const pick = (oid: string) => attrs.find((a) => a.type === oid)?.value.valueBlock.value as string | undefined;
  return pick(CN_OID) ?? pick(ORG_OID);
}

/** Find every /ByteRange + /Contents signature pair in the raw PDF bytes and verify each. */
export async function verifyPdfSignatures(pdf: Uint8Array, trustedFingerprints: string[]): Promise<SignatureFacts[]> {
  const raw = Buffer.from(pdf).toString("latin1");
  const results: SignatureFacts[] = [];
  const byteRangeRe = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  for (const m of raw.matchAll(byteRangeRe)) {
    const [a, b, c, d] = m.slice(1, 5).map(Number);
    const facts: SignatureFacts = { valid: false, coversWholeFile: a === 0 && c + d === pdf.length, trusted: false };
    try {
      // The signature value sits in the gap between the two signed ranges: <hex...>.
      const gap = raw.slice(a + b, c);
      const hex = /<([0-9A-Fa-f\s]+)>/.exec(gap)?.[1].replace(/\s+/g, "").replace(/(00)+$/, "");
      if (!hex) throw new Error("no signature value");
      const der = Buffer.from(hex.length % 2 ? hex + "0" : hex, "hex");
      const signedBytes = Buffer.concat([Buffer.from(pdf.subarray(a, a + b)), Buffer.from(pdf.subarray(c, c + d))]);

      ensureEngine();
      const asn = asn1js.fromBER(new Uint8Array(der).buffer);
      if (asn.offset === -1) throw new Error("signature is not valid DER");
      const content = new pkijs.ContentInfo({ schema: asn.result });
      const signed = new pkijs.SignedData({ schema: content.content });
      const verified = await signed.verify({ signer: 0, data: new Uint8Array(signedBytes).buffer, checkChain: false });
      facts.valid = verified === true;

      const cert = (signed.certificates ?? []).find((x): x is pkijs.Certificate => x instanceof pkijs.Certificate);
      if (cert) {
        facts.signer = signerName(cert);
        facts.fingerprint = createHash("sha256").update(Buffer.from(cert.toSchema().toBER(false))).digest("hex");
        facts.trusted = facts.valid && facts.coversWholeFile && trustedFingerprints.includes(facts.fingerprint);
      }
    } catch (err) {
      facts.error = (err as Error).message;
    }
    results.push(facts);
  }
  return results;
}
