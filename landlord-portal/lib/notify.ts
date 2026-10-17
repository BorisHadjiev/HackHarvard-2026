// Sends the request to the tenant. Owner: Boris.
// TODO(Boris): replace the console log with a Photon 2.0 text message
// (see messaging/README.md). Keep this function's signature so the API route doesn't change.
export async function notifyTenant(phone: string | undefined, link: string, summary: string): Promise<"sent" | "logged"> {
  console.log(`[notify] would text ${phone ?? "(no phone)"}: ${summary} -> ${link}`);
  return "logged";
}
