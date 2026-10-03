import { invokeTauri } from "@src/util/platform/tauri/init";

export interface KillAgentShellProcessOptions {
  pid: number;
  sessionId?: string;
  callId?: string;
  handle?: string;
}

export async function killAgentShellProcess({
  pid,
  sessionId,
  callId,
  handle,
}: KillAgentShellProcessOptions): Promise<string> {
  if (!sessionId || !callId || !handle) {
    throw new Error(
      "The process registration is unavailable; refresh its status before stopping it"
    );
  }
  // The monitor publishes the terminal verdict after the process tree and
  // output pipeline have stopped. A successful request is not an exit event.
  return invokeTauri<string>("agent_kill_shell_process", {
    pid,
    sessionId,
    callId,
    handle,
  });
}
