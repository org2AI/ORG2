/**
 * Inbox Persistence Atom
 *
 * Persists work-item assignment notifications through the existing inbox API.
 * SQLite owns message status; this writer retains no frontend message cache.
 */
import { invoke } from "@tauri-apps/api/core";
import { atom } from "jotai";

import type { InboxMessage } from "@src/api/types/inbox";
import { createLogger } from "@src/hooks/logger";

const log = createLogger("inbox");

// ============================================
// DB row shape (matches Rust InboxMessage)
// ============================================

interface InboxDbRow {
  id: string;
  title: string;
  preview: string;
  content: string;
  category: string;
  priority: string;
  status: string;
  senderName: string | null;
  /** JSON string */
  metadata: string;
  /** JSON string */
  labels: string;
  createdAt: string;
  updatedAt: string;
}

function inboxMessageToDbRow(msg: InboxMessage): InboxDbRow {
  return {
    id: msg.id,
    title: msg.title,
    preview: msg.preview,
    content: msg.content,
    category: msg.category,
    priority: msg.priority,
    status: msg.status,
    senderName: msg.sender?.name ?? null,
    metadata: JSON.stringify(msg.metadata ?? {}),
    labels: JSON.stringify(msg.labels ?? []),
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
  };
}

/** Persist a message; the database preserves existing read/archive status. */
export const upsertInboxMessageAtom = atom(
  null,
  async (_get, _set, msg: InboxMessage) => {
    const row = inboxMessageToDbRow(msg);
    try {
      await invoke("inbox_upsert", { message: row });
    } catch (err) {
      log.error("[inbox] Failed to upsert:", err);
    }
  }
);
upsertInboxMessageAtom.debugLabel = "upsertInboxMessageAtom";
