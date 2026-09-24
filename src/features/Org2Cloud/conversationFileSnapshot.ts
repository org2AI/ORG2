import { rpc } from "@src/api/tauri/rpc";

import { fileSha256 } from "./sharedSessionFilesClient";

/** Bounded IPC chunks; no fallback to the mutable source under any failure. */
export async function readConversationFileSnapshot(
  input: Parameters<typeof rpc.cloudFileOutbox.readSnapshot>[0],
  signal?: AbortSignal
): Promise<Uint8Array | null> {
  let bytes: Uint8Array | undefined;
  let hash: string | null = null;
  let capturedAt: number | null = null;
  let offset = 0;
  do {
    signal?.throwIfAborted();
    const chunk = await rpc.cloudFileOutbox.readSnapshotChunk({
      ...input,
      offset,
    });
    signal?.throwIfAborted();
    if (chunk.status !== "captured" || chunk.bytesBase64 === null) return null;
    if (!bytes) {
      if (
        chunk.size > 32 * 1024 * 1024 ||
        chunk.size < 0 ||
        !Number.isSafeInteger(chunk.size)
      )
        throw new Error("Invalid snapshot size");
      bytes = new Uint8Array(chunk.size);
      hash = chunk.sha256;
      capturedAt = chunk.capturedAt;
    }
    if (
      chunk.offset !== offset ||
      chunk.size !== bytes.length ||
      chunk.sha256 !== hash ||
      chunk.capturedAt !== capturedAt
    )
      throw new Error("Snapshot receipt changed during read");
    const binary = atob(chunk.bytesBase64);
    if (
      binary.length > 256 * 1024 ||
      offset + binary.length > bytes.length ||
      (!binary.length && offset < bytes.length)
    )
      throw new Error("Invalid snapshot chunk");
    for (let i = 0; i < binary.length; i++)
      bytes[offset + i] = binary.charCodeAt(i);
    offset += binary.length;
  } while (offset < bytes.length);
  if ((await fileSha256(bytes)) !== hash)
    throw new Error("Snapshot integrity check failed");
  signal?.throwIfAborted();
  return bytes;
}
