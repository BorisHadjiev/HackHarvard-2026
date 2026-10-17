// Read the Approve / document-check body: JSON (bank only) or multipart form data (with documents).
import { MAX_FILES } from "./documents/extract";
import type { UploadedFile } from "./documents/types";

export interface EvidenceRequest {
  requestId: string;
  portal?: string;
  tenant?: string;
  plaidLinkId?: string;
  mode: "bank" | "documents" | "age";
  /** Documents mode: also cross-check the documents against the chosen bank data. */
  confirmWithBank: boolean;
  files: UploadedFile[];
  rent?: number;
  multiple?: number;
}

export async function readEvidenceRequest(req: Request): Promise<EvidenceRequest> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const str = (k: string) => (typeof form.get(k) === "string" ? String(form.get(k)) : undefined);
    const files: UploadedFile[] = [];
    for (const f of form.getAll("documents").slice(0, MAX_FILES)) {
      if (typeof f === "string") continue;
      files.push({ name: f.name || "document", type: f.type, data: new Uint8Array(await f.arrayBuffer()) });
    }
    return {
      requestId: str("requestId") ?? "",
      portal: str("portal"),
      tenant: str("tenant"),
      plaidLinkId: str("plaidLinkId"),
      mode: str("mode") === "documents" ? "documents" : str("mode") === "age" ? "age" : "bank",
      confirmWithBank: str("confirmWithBank") !== "false",
      files,
      rent: str("rent") ? Number(str("rent")) : undefined,
      multiple: str("multiple") ? Number(str("multiple")) : undefined,
    };
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    requestId: String(body.requestId ?? ""),
    portal: typeof body.portal === "string" ? body.portal : undefined,
    tenant: typeof body.tenant === "string" ? body.tenant : undefined,
    plaidLinkId: typeof body.plaidLinkId === "string" ? body.plaidLinkId : undefined,
    mode: "bank",
    confirmWithBank: true,
    files: [],
  };
}
