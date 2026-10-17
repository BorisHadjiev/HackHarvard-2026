// The link inside a Photon text. Host comes from TENANT_APP_URL.
// The repo does not publish a public tenant origin; the default is the tenant app on this machine.

/** Page the recipient opens: the tenant verification screen for this request. */
export function tenantVerificationLink(tenantAppUrl: string, requestId: string, portalOrigin: string): string {
  const base = tenantAppUrl.trim().replace(/\/+$/, "");
  const url = new URL(`/request/${requestId}`, `${base}/`);
  url.searchParams.set("portal", portalOrigin);
  return url.toString();
}
