import { emit } from "@tauri-apps/api/event";
import { atom } from "jotai";
import type { Store } from "jotai/vanilla/store";

import { rpc } from "@src/api/tauri/rpc";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { createLogger } from "@src/hooks/logger";

import {
  type Org2CloudAuthState,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import { collectSessionSharedFiles } from "./sessionSharedFileCandidates";

export const conversationFileOutboxSignalAtom = atom(0);
export const CONVERSATION_FILE_OUTBOX_CHANGED =
  "org2-conversation-file-outbox-changed";
const log = createLogger("ConversationFileOutbox");

/** Enqueue metadata only; never wait for capabilities, disk reads or network uploads. */
export async function enqueueConversationSharedFiles(input: {
  store: Store;
  auth: Org2CloudAuthState;
  orgId: string;
  sessionId: string;
  events: readonly SessionEvent[];
  assertCurrentIdentity: () => void;
}): Promise<void> {
  const candidates = collectSessionSharedFiles(input.events);
  // IPC batches bound transient memory. This is not an attachment count quota:
  // all candidates are persisted; retries deduplicate a partially saved batch.
  for (let offset = 0; offset < candidates.length; offset += 256) {
    input.assertCurrentIdentity();
    await rpc.cloudFileOutbox.enqueue({
      identity: org2CloudAuthIdentityKey(input.auth),
      orgId: input.orgId,
      sessionId: input.sessionId,
      candidates: candidates.slice(offset, offset + 256),
    });
    input.assertCurrentIdentity();
  }
  if (candidates.length) {
    input.store.set(conversationFileOutboxSignalAtom, (value) => value + 1);
    // Other windows may own the active sync engine. The local signal also
    // works if the cross-window notification transport is unavailable.
    void emit(CONVERSATION_FILE_OUTBOX_CHANGED).catch((error) => {
      log.warn("Attachment journal saved; peer wake-up was unavailable", error);
    });
  }
}
