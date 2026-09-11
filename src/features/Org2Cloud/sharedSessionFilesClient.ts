import { z } from "zod/v4";

import { type CloudEndpoint } from "./config";
import { fetchWithTransportRetry } from "./org2CloudFetchRetry";

export class SharedSessionFileRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly recoveryPending = false
  ) {
    super(message);
    this.name = "SharedSessionFileRequestError";
  }
}

export const SHARED_FILE_MAX_BYTES = 32 * 1024 * 1024;
const FileSchema = z.object({
  id: z.string().uuid(),
  name: z
    .string()
    .min(1)
    .max(255)
    .refine(
      (name) =>
        !/[\\/]/.test(name) &&
        !Array.from(name).some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        ) &&
        name !== "." &&
        name !== ".."
    ),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().min(0).max(SHARED_FILE_MAX_BYTES),
});
export type SharedSessionFile = z.infer<typeof FileSchema>;
export function encodeFileBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
export async function fileSha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}
async function rpc(
  token: string,
  endpoint: CloudEndpoint,
  method: string,
  body: unknown,
  signal?: AbortSignal
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetchWithTransportRetry(
      `${endpoint.supabaseUrl}/rest/v1/rpc/${method}`,
      {
        method: "POST",
        headers: {
          apikey: endpoint.anonKey,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "content-profile": "org2_cloud",
        },
        body: JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, controller.signal])
          : controller.signal,
      }
    );
    if (!response.ok)
      throw new SharedSessionFileRequestError(
        `Shared file request failed (${response.status}). Check session access, file quota, and server support.`,
        response.status
      );
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}
export async function uploadSharedSessionFile(
  token: string,
  endpoint: CloudEndpoint,
  orgId: string,
  sessionId: string,
  name: string,
  bytes: Uint8Array,
  source?: { path: string; revision: string }
): Promise<SharedSessionFile> {
  if (bytes.byteLength > SHARED_FILE_MAX_BYTES)
    throw new Error("Shared file exceeds the 32 MiB transfer limit");
  const result = FileSchema.parse(
    await rpc(token, endpoint, "cloud_put_session_file", {
      p_org_id: orgId,
      p_session_id: sessionId,
      p_name: name,
      p_content: encodeFileBytes(bytes),
      ...(source
        ? { p_source_path: source.path, p_source_revision: source.revision }
        : {}),
    })
  );
  if (
    result.name !== name ||
    result.size !== bytes.byteLength ||
    result.sha256 !== (await fileSha256(bytes))
  )
    throw new Error("Shared file upload integrity check failed");
  return result;
}
export async function readSharedSessionFile(
  token: string,
  endpoint: CloudEndpoint,
  id: string,
  signal?: AbortSignal
): Promise<SharedSessionFile & { bytes: Uint8Array }> {
  const wire = FileSchema.extend({
    content: z.string().max(Math.ceil(SHARED_FILE_MAX_BYTES / 3) * 4 + 10),
  }).parse(
    await rpc(
      token,
      endpoint,
      "cloud_get_session_file",
      { p_file_id: id },
      signal
    )
  );
  const bytes = Uint8Array.from(atob(wire.content), (character) =>
    character.charCodeAt(0)
  );
  if (
    wire.id !== id ||
    bytes.length !== wire.size ||
    (await fileSha256(bytes)) !== wire.sha256
  )
    throw new Error("Shared file download integrity check failed");
  return {
    id: wire.id,
    name: wire.name,
    size: wire.size,
    sha256: wire.sha256,
    bytes,
  };
}

/** Look up an artifact without loading its bytes; completed revisions avoid repeat filesystem reads. */
export async function findSharedSessionFile(
  token: string,
  endpoint: CloudEndpoint,
  orgId: string,
  sessionId: string,
  sourcePath: string,
  revision?: string,
  signal?: AbortSignal
): Promise<SharedSessionFile | null> {
  const value = await rpc(
    token,
    endpoint,
    "cloud_find_session_file",
    {
      p_org_id: orgId,
      p_session_id: sessionId,
      p_source_path: sourcePath,
      p_source_revision: revision ?? null,
    },
    signal
  );
  return value === null ? null : FileSchema.parse(value);
}

export async function findSharedSessionFileRevisions(
  token: string,
  endpoint: CloudEndpoint,
  orgId: string,
  sessionId: string,
  files: readonly { path: string; revision: string }[]
): Promise<Set<string>> {
  if (files.length > 64) throw new Error("Shared file lookup batch exceeded");
  const rows = z
    .array(z.object({ path: z.string(), revision: z.string() }))
    .max(64)
    .parse(
      await rpc(token, endpoint, "cloud_find_session_file_revisions", {
        p_org_id: orgId,
        p_session_id: sessionId,
        p_files: files,
      })
    );
  return new Set(rows.map((row) => `${row.path}\0${row.revision}`));
}
