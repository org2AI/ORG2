import { invoke } from "@tauri-apps/api/core";

export interface DocumentApplication {
  path: string;
  name: string;
  isDefault: boolean;
}

// Exact file keys preserve per-document default-app associations. At most 32
// entries (including in-flight requests); expiry is checked only on demand.
const entries = new Map<
  string,
  {
    promise: Promise<DocumentApplication[]>;
    expiresAt: number;
    pending: boolean;
  }
>();
const TTL_MS = 60_000;
const MAX_ENTRIES = 32;

export function loadDocumentApplications(
  path: string
): Promise<DocumentApplication[]> {
  const existing = entries.get(path);
  if (existing && (existing.pending || existing.expiresAt > Date.now())) {
    entries.delete(path);
    entries.set(path, existing);
    return existing.promise;
  }
  entries.delete(path);
  if (entries.size >= MAX_ENTRIES) {
    const oldest = [...entries].find(([, entry]) => !entry.pending);
    if (!oldest)
      return Promise.reject(new Error("Application discovery is busy"));
    entries.delete(oldest[0]);
  }
  const entry = {
    promise: invoke<DocumentApplication[]>("document_applications", { path }),
    expiresAt: 0,
    pending: true,
  };
  entries.set(path, entry);
  entry.promise = entry.promise.then(
    (apps) => {
      entry.pending = false;
      entry.expiresAt = Date.now() + TTL_MS;
      return apps;
    },
    (error: unknown) => {
      entries.delete(path);
      throw error;
    }
  );
  return entry.promise;
}

export function openDocument(
  path: string,
  application?: string
): Promise<void> {
  return invoke("document_open", { path, application: application ?? null });
}

export function isExternalDocument(path: string): boolean {
  return /\.(pdf|docx?|xlsx?|pptx?|pages|numbers|key|odt|ods|odp|rtf)$/i.test(
    path
  );
}
