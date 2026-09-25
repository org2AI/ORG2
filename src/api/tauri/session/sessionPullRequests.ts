import { invoke } from "@tauri-apps/api/core";

/** Explicit provider attachments, scoped to the conversation; newest first. */
export function readSessionPullRequests(sessionId: string): Promise<string[]> {
  return invoke<string[]>("session_pull_requests", { sessionId });
}
