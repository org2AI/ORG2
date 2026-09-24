import { rpc } from "@src/api/tauri/rpc";

/** No local-path fallback, including when a receipt is missing or corrupted. */
export async function readConversationFileSnapshot(
  input: Parameters<typeof rpc.cloudFileOutbox.readSnapshot>[0]
): Promise<Uint8Array | null> {
  const snapshot = await rpc.cloudFileOutbox.readSnapshot(input);
  if (snapshot.status !== "captured" || snapshot.bytesBase64 === null)
    return null;
  return Uint8Array.from(atob(snapshot.bytesBase64), (character) =>
    character.charCodeAt(0)
  );
}
