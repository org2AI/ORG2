import { invoke } from "@tauri-apps/api/core";

export interface SessionToolActivity {
  callId: string;
  toolName: string;
  group: string;
  status: "success" | "error";
  error?: string;
  actions: Array<{
    kind: "search" | "open" | "read-terminal" | "generic";
    query?: string;
    url?: string;
  }>;
}

/** One resource-bearing message as `session_source_messages` returns it. */
export interface SessionSourceMessage {
  id: string;
  text: string;
  images?: readonly string[];
  /** Older backends omit this and represent user messages only. */
  role?: "user" | "assistant" | "tool";
  /** Only successful structured tool references are projected by the backend. */
  toolName?: string;
  toolActivity?: SessionToolActivity;
}

/**
 * Resource-bearing messages of a session, reduced by Rust to the lines that can
 * carry an explicit file/web reference and image references a thumbnail loads on demand
 * (never inline bytes). Reads the session's own history store, so turns that
 * are not loaded in the chat are included.
 */
export function readSessionSourceMessages(
  sessionId: string
): Promise<SessionSourceMessage[]> {
  return invoke<SessionSourceMessage[]>("session_source_messages", {
    sessionId,
  });
}
