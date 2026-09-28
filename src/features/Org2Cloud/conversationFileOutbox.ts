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

/** Capture immutable local bytes and enqueue; never wait for network upload. */
export async function enqueueConversationSharedFiles(input: {
  store: Store;
  auth: Org2CloudAuthState;
  orgId: string;
  sessionId: string;
  events: readonly SessionEvent[];
  assertCurrentIdentity: () => void;
}): Promise<void> {
  const candidates = collectSessionSharedFiles(input.events);
  // A capture may read 32 MiB. Check identity between individual files, and
  // wake delivery after each durable handoff instead of filling the entire
  // local staging budget before any upload can begin.
  for (const candidate of candidates) {
    input.assertCurrentIdentity();
    await rpc.cloudFileOutbox.enqueue({
      identity: org2CloudAuthIdentityKey(input.auth),
      orgId: input.orgId,
      sessionId: input.sessionId,
      candidates: [candidate],
    });
    input.assertCurrentIdentity();
    input.store.set(conversationFileOutboxSignalAtom, (value) => value + 1);
    void emit(CONVERSATION_FILE_OUTBOX_CHANGED).catch((error) => {
      log.warn("Attachment journal saved; peer wake-up was unavailable", error);
    });
  }
}
