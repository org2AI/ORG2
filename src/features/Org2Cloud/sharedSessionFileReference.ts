/** Portable private file reference; the endpoint is an identity boundary, never a fetch target. */
export interface SharedSessionFileReference {
  id: string;
  endpoint: string;
  source?: { orgId: string; sessionId: string; path: string };
}
export function buildSharedSessionFileReference(
  id: string,
  endpoint: string
): string {
  return `orgii-file://${id}?endpoint=${encodeURIComponent(endpoint.replace(/\/+$/, ""))}`;
}
export function parseSharedSessionFileReference(
  value: string
): SharedSessionFileReference | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "orgii-file:" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        url.hostname
      ) ||
      url.pathname ||
      url.hash ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    const endpoint = url.searchParams.get("endpoint");
    if (
      !endpoint ||
      url.searchParams.getAll("endpoint").length !== 1 ||
      [...url.searchParams.keys()].some((key) => key !== "endpoint")
    )
      return null;
    return { id: url.hostname, endpoint };
  } catch {
    return null;
  }
}
