import { invoke } from "@tauri-apps/api/core";

/** One user message as `session_source_messages` returns it. */
export interface SessionSourceMessage {
  id: string;
  text: string;
  images?: readonly string[];
}

/**
 * Every user message of a session, reduced by Rust to the lines that can
 * carry a web reference and to image references a thumbnail loads on demand
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
