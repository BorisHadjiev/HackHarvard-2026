// Public origin of this portal, used in the tenant link from POST /api/requests.
// Render's proxy can make req.url an internal address, so prefer an explicit URL.

function firstCsv(value: string | null): string | undefined {
  const first = value?.split(",")[0]?.trim();
  return first || undefined;
}

/** Origin the tenant app should call. PUBLIC_PORTAL_URL, then proxy headers, then the request URL. */
export function portalPublicOrigin(req: Request): string {
  const configured = process.env.PUBLIC_PORTAL_URL?.trim();
  if (configured) return new URL(configured).origin;

  const proto = firstCsv(req.headers.get("x-forwarded-proto"));
  const host = firstCsv(req.headers.get("x-forwarded-host"));
  if (proto && host) return `${proto}://${host}`;

  return new URL(req.url).origin;
}
