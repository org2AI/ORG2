import type { Terminal } from "@xterm/xterm";
import type { MutableRefObject } from "react";

import { createLogger } from "@src/hooks/logger";
import type { ShellType } from "@src/store/ui/editorSettingsAtom";
import {
  createTauriChannel,
  invokeTauri,
  isTauriReady,
  listenTauri,
} from "@src/util/platform/tauri/init";
import { publishPtyOutput } from "@src/util/terminal/ptyOutputBus";
import { decodePtyOutputFrame } from "@src/util/terminal/ptyOutputFrame";
import {
  type PtyOutputPayload,
  ptyPayloadBytes,
} from "@src/util/terminal/ptyOutputPayload";

import { deleteTerminalBuffer, getTerminalBuffer } from "./bufferCache";
import {
  ackBytesWithoutWrite,
  flushBacklog,
  isPaneForeground,
  notifyUserInput,
  ownsPane,
  registerPane,
  resumePane,
  scheduleWrite,
  setPaneForeground,
  suspendPane,
  unregisterPane,
} from "./terminalOutputScheduler";
import { formatLastLogin, resolvePtyLaunchOptions } from "./terminalPtyLaunch";
import { writeWithRenderSettle } from "./terminalRenderSettle";
import type { TerminalViewProps } from "./types";
import { writeBrowserModeMessage } from "./utils/browserModeMessage";

const log = createLogger("TerminalView");
let lastOwnerId = 0;
function nextOwnerId(): number {
  lastOwnerId = Math.max(lastOwnerId + 1, Date.now() * 1000);
  return lastOwnerId;
}

/**
 * Estimate UTF-8 byte length of a string without a TextEncoder allocation.
 *
 * Terminal output is overwhelmingly ASCII (shell prompts, command output,
 * ANSI sequences). The rare non-ASCII cases (emoji, CJK) over-estimate by
 * at most 3 bytes per character, which is acceptable — byte_count is used
 * as a backpressure hint, not an exact invariant.
 *
 * Implementation: charCode > 0x7F catches all non-ASCII BMP code points; a
 * surrogate pair (charCode > 0x7FF in both high+low halves) is counted as
 * +3 each which approximates the 4-byte UTF-8 encoding of the astral plane.
 */
function estimateByteLength(s: string): number {
  let len = s.length; // start with 1 byte per char (ASCII baseline)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x7f) {
      // Non-ASCII: add extra bytes beyond the already-counted baseline byte.
      // U+0080–U+07FF → 2-byte UTF-8 (+1)
      // U+0800–U+FFFF → 3-byte UTF-8 (+2)
      len += c > 0x7ff ? 2 : 1;
    }
  }
  return len;
}

interface PtySessionIdentity {
  session_generation: string;
}

interface PtyExitEvent extends PtySessionIdentity {
  owner_id: number;
}

interface AttachPtyStreamResponse extends Partial<PtySessionIdentity> {
  pending_utf8_b64?: string;
  output: string;
  covers_seq: number;
  missed_output: boolean;
}

interface InitPtyConnectionParams {
  cols: number;
  rows: number;
  sessionKey: string;
  isForeground: boolean;
  terminalRef: MutableRefObject<Terminal | null>;
  sessionIdRef: MutableRefObject<string | null>;
  unlistenOutputRef: MutableRefObject<(() => void) | null>;
  unlistenExitRef: MutableRefObject<(() => void) | null>;
  repoPathRef: MutableRefObject<string | undefined>;
  shellType: ShellType;
  customShellPath?: string;
  shellOverride?: string;
  argsOverride?: string[];
  envOverride?: Record<string, string>;
  forceRepoCwd?: boolean;
  nameOverride?: string;
  onSessionInfoReady?: TerminalViewProps["onSessionInfoReady"];
  setIsBrowserMode: (value: boolean) => void;
  setIsConnecting: (value: boolean) => void;
  abortSignal?: AbortSignal;
}

/**
 * Leaf guard for every async PTY write. Identity is as important as abort:
 * React may already have mounted a replacement terminal in the same ref by
 * the time an IPC/snapshot/scheduler continuation resumes.
 */
export function writeToLiveTerminal(
  terminalRef: MutableRefObject<Terminal | null>,
  terminal: Terminal,
  isAborted: () => boolean,
  data: string | Uint8Array,
  sessionId?: string
): boolean {
  if (isAborted() || terminalRef.current !== terminal) return false;
  try {
    // Only a visible pane earns repaint coordination; a hidden one would pay
    // for frames nobody sees.
    if (sessionId && isPaneForeground(sessionId)) {
      writeWithRenderSettle(terminal, data);
    } else {
      terminal.write(data);
    }
    return true;
  } catch (error) {
    // xterm renderer disposal must never replace the whole application with
    // an error boundary. A later live terminal/output snapshot can recover.
    log.warn("[TerminalView] Dropped write for unavailable renderer:", error);
    return false;
  }
}

/**
 * Notify the output scheduler that the user typed into the given session.
 * Must be called from the terminal's onData handler to enable interactive bypass.
 */
export function notifyPtyUserInput(sessionId: string): void {
  notifyUserInput(sessionId);
}

async function fetchPtyInfo(
  sessionId: string,
  sessionKey: string,
  isTerminalLive: () => boolean,
  onSessionInfoReady?: TerminalViewProps["onSessionInfoReady"]
) {
  try {
    const ptyInfo = await invokeTauri<{
      session_id: string;
      pid: number | null;
      shell: string;
      cwd: string | null;
    }>("get_pty_info", {
      sessionId,
    });

    if (!isTerminalLive()) return;
    onSessionInfoReady?.({
      sessionKey,
      pid: ptyInfo.pid || undefined,
      shell: ptyInfo.shell,
      cwd: ptyInfo.cwd || undefined,
    });
  } catch (error) {
    log.error("[TerminalView] Failed to get PTY info:", error);
  }
}

async function reconnectOrCreatePty({
  ownerId,
  onSessionIdentity,
  restorePendingUtf8,
  getSize,
  sessionId,
  sessionKey,
  repoPath,
  shellType,
  customShellPath,
  shellOverride,
  argsOverride,
  envOverride,
  forceRepoCwd,
  nameOverride,
  isTerminalLive,
  writeToTerminal,
  onSessionInfoReady,
}: {
  ownerId: number;
  onSessionIdentity: (identity: Partial<PtySessionIdentity> | void) => void;
  restorePendingUtf8: (b64: string) => void;
  getSize: () => { cols: number; rows: number };
  sessionId: string;
  sessionKey: string;
  repoPath?: string;
  shellType: ShellType;
  customShellPath?: string;
  shellOverride?: string;
  argsOverride?: string[];
  envOverride?: Record<string, string>;
  forceRepoCwd?: boolean;
  nameOverride?: string;
  isTerminalLive: () => boolean;
  writeToTerminal: (data: string | Uint8Array) => void;
  onSessionInfoReady?: TerminalViewProps["onSessionInfoReady"];
}) {
  let ptyExists = false;
  try {
    await invokeTauri("resize_pty", {
      request: {
        session_id: sessionId,
        ...getSize(),
      },
    });
    ptyExists = true;
  } catch {
    ptyExists = false;
  }

  if (!isTerminalLive()) return;

  if (!ptyExists) {
    writeToTerminal(`${formatLastLogin(sessionKey)}\r\n`);

    const { cwd, shell } = resolvePtyLaunchOptions({
      repoPath,
      shellType,
      customShellPath,
      shellOverride,
      forceRepoCwd,
    });

    const launchSize = getSize();
    const created = await invokeTauri<PtySessionIdentity | void>("create_pty", {
      request: {
        session_id: sessionId,
        owner_id: ownerId,
        ...launchSize,
        cwd,
        shell,
        args: argsOverride || null,
        env: envOverride || null,
        name: nameOverride || null,
      },
    });

    onSessionIdentity(created);
    if (!isTerminalLive()) return;
    // Fits during native creation can send resize_pty before the session is
    // registered. Reconcile that lost resize before releasing queued output.
    const currentSize = getSize();
    if (
      currentSize.cols !== launchSize.cols ||
      currentSize.rows !== launchSize.rows
    ) {
      await invokeTauri("resize_pty", {
        request: { session_id: sessionId, ...currentSize },
      });
      if (!isTerminalLive()) return;
    }
    await fetchPtyInfo(
      sessionId,
      sessionKey,
      isTerminalLive,
      onSessionInfoReady
    );
    return undefined;
  }

  // Live session: attach atomically. The backend resumes event emission,
  // resets the flow-control window (fresh listener, no debt — this is what
  // recovers a reader parked on ACKs lost to the previous listener), and
  // returns the restore snapshot plus the stream offset it covers.
  try {
    const attach = await invokeTauri<AttachPtyStreamResponse>(
      "attach_pty_stream",
      { sessionId, ownerId }
    );

    onSessionIdentity(attach);
    if (!isTerminalLive()) return attach.covers_seq;
    const cachedBuffer = getTerminalBuffer(sessionId);
    deleteTerminalBuffer(sessionId);
    if (cachedBuffer && !attach.missed_output) {
      // Nothing was produced while detached: the client-side serialized
      // buffer is the richer restore (full scrollback vs bounded snapshot).
      writeToTerminal(cachedBuffer);
    } else if (attach.output) {
      writeToTerminal(attach.output);
    }
    if (attach.pending_utf8_b64) restorePendingUtf8(attach.pending_utf8_b64);
    return attach.covers_seq;
  } catch (error) {
    // Backend without attach_pty_stream (hot-reload version skew) — legacy
    // restore: client buffer if present, else bounded snapshot + window resync.
    log.warn(
      "[TerminalView] attach_pty_stream unavailable, using legacy restore:",
      error
    );

    const cachedBuffer = getTerminalBuffer(sessionId);
    if (cachedBuffer) {
      if (!isTerminalLive()) return undefined;
      writeToTerminal(cachedBuffer);
      deleteTerminalBuffer(sessionId);
      return undefined;
    }

    try {
      const snapshot = await invokeTauri<{
        output: string;
        unacked_bytes?: number;
      }>("get_pty_output_snapshot", { sessionId });

      if (!isTerminalLive()) return undefined;
      if (snapshot.output) {
        writeToTerminal(snapshot.output);
      }
      if (snapshot.unacked_bytes && snapshot.unacked_bytes > 0) {
        await invokeTauri("ack_pty_data", {
          sessionId,
          byteCount: snapshot.unacked_bytes,
        });
      }
    } catch (snapshotError) {
      log.error(
        "[TerminalView] Failed to restore PTY output snapshot:",
        snapshotError
      );
    }
    return undefined;
  }
}

/**
 * Move a live session's output onto the binary channel transport.
 *
 * Best-effort: a backend without `attach_pty_output_channel` (hot-reload
 * version skew) keeps emitting `pty-output-{id}` events, which the listener
 * registered by the caller still consumes. The swap cannot reorder output —
 * the reader task dispatches both transports through the same webview eval
 * queue, and the channel preserves order across its own asynchronous fetches.
 */
async function attachPtyOutputChannel(
  sessionId: string,
  ownerId: number,
  isAborted: () => boolean,
  consumePtyBytes: (chunk: Uint8Array, byteCount: number, seq?: number) => void
): Promise<void> {
  try {
    const channel = createTauriChannel<ArrayBuffer>((message) => {
      if (isAborted()) return;
      const frame = decodePtyOutputFrame(message);
      // A frame too short to hold its header carries no recoverable payload;
      // dropping it is safer than guessing a stream offset. It is also never
      // ACKed, which the backend's stall watchdog resolves by detaching.
      if (!frame || frame.bytes.length === 0) return;
      consumePtyBytes(frame.bytes, frame.bytes.length, frame.seq);
    });

    await invokeTauri("attach_pty_output_channel", {
      sessionId,
      ownerId,
      channel,
    });
  } catch (error) {
    log.warn(
      "[TerminalView] Binary output channel unavailable, using event transport:",
      error
    );
  }
}

export async function initPtyConnection({
  cols,
  rows,
  sessionKey,
  isForeground,
  terminalRef,
  sessionIdRef,
  unlistenOutputRef,
  unlistenExitRef,
  repoPathRef,
  shellType,
  customShellPath,
  shellOverride,
  argsOverride,
  envOverride,
  forceRepoCwd,
  nameOverride,
  onSessionInfoReady,
  setIsBrowserMode,
  setIsConnecting,
  abortSignal,
}: InitPtyConnectionParams) {
  const isAborted = () => abortSignal?.aborted === true;

  if (!isTauriReady()) {
    if (isAborted()) return;
    setIsBrowserMode(true);
    setIsConnecting(false);

    const terminal = terminalRef.current;
    if (terminal) {
      writeBrowserModeMessage(terminal);
    }
    return;
  }

  const sessionId = `terminal-pty-${sessionKey}`;
  sessionIdRef.current = sessionId;
  let releaseConnection: (() => void) | undefined;
  let ownsConnection = () => !isAborted();

  try {
    const terminal = terminalRef.current;
    if (!terminal || isAborted()) return;
    const ownerId = nextOwnerId();
    const isTerminalLive = () =>
      !isAborted() && terminalRef.current === terminal && ownsPane(pane);

    ownsConnection = isTerminalLive;
    const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

    // Stable write callback — captured once per session so the hot IPC
    // handler never allocates a new closure per event. The identity guard is
    // deliberately inside the callback: a scheduler turn already queued
    // before cleanup must also be harmless after this terminal is replaced.
    const terminalWrite = (d: string | Uint8Array) =>
      writeToLiveTerminal(terminalRef, terminal, isAborted, d, sessionId);

    // Register this pane with the output scheduler, suspended: chunks that
    // arrive during connect queue up in order but nothing is written until
    // the restore base (snapshot or cached buffer) is in place — otherwise
    // live output interleaves with the restore and garbles the screen.
    const pane = registerPane(sessionId, terminalWrite, ownerId);
    let ownOutputUnlisten: (() => void) | undefined;
    let ownExitUnlisten: (() => void) | undefined;
    const pendingChunks: {
      chunk: Uint8Array;
      byteCount: number;
      seq?: number;
    }[] = [];
    const release = () => {
      abortSignal?.removeEventListener("abort", release);
      pendingChunks.length = 0;
      ownOutputUnlisten?.();
      ownOutputUnlisten = undefined;
      ownExitUnlisten?.();
      ownExitUnlisten = undefined;
      unregisterPane(sessionId, pane);
      void invokeTauri("detach_pty_stream", { sessionId, ownerId }).catch(
        () => undefined
      );
    };
    releaseConnection = release;
    abortSignal?.addEventListener("abort", release, { once: true });
    let restoring = true;
    let restoredThrough: number | undefined;
    let sessionGeneration: string | undefined;
    const restorePendingUtf8 = (b64: string) => {
      utf8Decoder.decode(
        Uint8Array.from(atob(b64), (char) => char.charCodeAt(0)),
        { stream: true }
      );
    };
    suspendPane(sessionId);
    setPaneForeground(sessionId, isForeground);

    // Shared by both output transports: the binary channel installed below and
    // the `pty-output-{id}` event the backend falls back to when no channel is
    // attached. Only one of them delivers any given chunk.
    const consumePtyBytes = (
      chunk: Uint8Array,
      byteCount: number,
      seq?: number
    ) => {
      if (!isTerminalLive()) return;
      if (restoring) {
        pendingChunks.push({ chunk, byteCount, seq });
        return;
      }
      if (
        seq !== undefined &&
        restoredThrough !== undefined &&
        seq < restoredThrough
      ) {
        const covered = Math.min(chunk.length, restoredThrough - seq);
        chunk = chunk.subarray(covered);
        byteCount = Math.max(0, byteCount - covered);
        seq += covered;
        if (chunk.length === 0) return;
      }
      const decoded = utf8Decoder.decode(chunk, { stream: true });
      if (decoded) {
        // Observers (advertised-URL sniffing, status indicators) read the
        // stream here: the channel transport has a single receiver, so a
        // second Tauri listener would see nothing.
        publishPtyOutput(sessionId, decoded);
        scheduleWrite(sessionId, decoded, byteCount, terminalWrite, seq);
      } else {
        // Chunk ended mid-codepoint and decoded to nothing — the bytes
        // sit in the decoder but still count against the backend
        // flow-control window.
        ackBytesWithoutWrite(sessionId, byteCount);
      }
    };

    const unlistenOutput = await listenTauri<
      PtyOutputPayload & { owner_id?: number }
    >(`pty-output-${sessionId}`, (event) => {
      if (!isTerminalLive()) return;

      if (
        event.payload.owner_id !== undefined &&
        event.payload.owner_id !== ownerId
      )
        return;
      const { byte_count: byteCount, seq, data } = event.payload;
      const chunk = ptyPayloadBytes(event.payload);

      if (chunk && chunk.length > 0) {
        consumePtyBytes(chunk, byteCount ?? chunk.length, seq);
      } else if (data) {
        // Backward-compat branch (no byte_count from backend): estimate byte
        // length without a TextEncoder allocation. ASCII is 1 byte/char;
        // non-ASCII (rare in terminal hot path) inflates slightly — the
        // scheduler treats byte_count as a flow-control hint, not an exact
        // invariant, so a cheap over-estimate is correct.
        const bytes = new TextEncoder().encode(data);
        consumePtyBytes(bytes, estimateByteLength(data), seq);
      }
    });
    ownOutputUnlisten = unlistenOutput;
    if (!isTerminalLive()) {
      release();
      return;
    }
    unlistenOutputRef.current = () => {
      abortSignal?.removeEventListener("abort", release);
      release();
    };

    // Owner filtering below confines this slot to this connection's native
    // exit (duplicates coalesce). Keep identity until the handshake resolves.
    let exitPending: { payload: PtyExitEvent | null } | undefined;
    const matchesExit = (payload: PtyExitEvent | null) => {
      if (sessionGeneration !== undefined) {
        return (
          payload?.session_generation === sessionGeneration &&
          payload.owner_id === ownerId
        );
      }
      // Only a legacy handshake may accept an unversioned legacy exit.
      // Paired releases always require both generation and attachment owner.
      return payload === null;
    };
    const finishExit = () => {
      if (!isTerminalLive()) return;

      // Drain any still-queued output before the banner so the final bytes
      // land in order (resume first in case exit raced a reconnect).
      resumePane(sessionId);
      flushBacklog(sessionId, Number.MAX_SAFE_INTEGER);

      const trailingOutput = utf8Decoder.decode();
      if (trailingOutput) {
        terminalWrite(trailingOutput);
      }
      terminalWrite("\r\n\x1b[33m[Session ended]\x1b[0m\r\n");
      unregisterPane(sessionId, pane);
    };
    const unlistenExit = await listenTauri<PtyExitEvent | null>(
      `pty-exit-${sessionId}`,
      (event) => {
        if (!isTerminalLive()) return;
        const payload = event.payload ?? null;
        if (payload && payload.owner_id !== ownerId) return;
        if (restoring) {
          exitPending = { payload };
          return;
        }
        if (matchesExit(payload)) finishExit();
      }
    );
    ownExitUnlisten = unlistenExit;
    if (!isTerminalLive()) {
      release();
      return;
    }
    unlistenExitRef.current = () => {
      ownExitUnlisten?.();
      ownExitUnlisten = undefined;
    };

    if (isAborted()) return;
    let coversSeq: number | undefined;
    try {
      coversSeq = await reconnectOrCreatePty({
        ownerId,
        onSessionIdentity: (identity) => {
          sessionGeneration = identity?.session_generation;
        },
        restorePendingUtf8,
        // Listener registration and the existence probe are asynchronous;
        // the fitted grid may have changed since initPtyConnection was called.
        getSize: () => ({
          cols: terminal.cols || cols || 80,
          rows: terminal.rows || rows || 20,
        }),
        sessionId,
        sessionKey,
        repoPath: repoPathRef.current,
        shellType,
        customShellPath,
        shellOverride,
        argsOverride,
        envOverride,
        forceRepoCwd,
        nameOverride,
        isTerminalLive,
        writeToTerminal: terminalWrite,
        onSessionInfoReady,
      });
      // The session exists now, whether it was created or reattached. Install
      // the channel while the pane is still suspended so chunks that straddle
      // the transport swap queue in arrival order instead of racing the
      // restore snapshot onto the screen.
      if (!isAborted()) {
        await attachPtyOutputChannel(
          sessionId,
          ownerId,
          () => !isTerminalLive(),
          consumePtyBytes
        );
      }
    } finally {
      // Always lift the suspension — a pane left suspended never renders.
      // Queued chunks the snapshot already covers are dropped here.
      if (isTerminalLive()) {
        restoredThrough = coversSeq;
        restoring = false;
        for (const pending of pendingChunks)
          consumePtyBytes(pending.chunk, pending.byteCount, pending.seq);
        pendingChunks.length = 0;
        resumePane(sessionId);
        if (exitPending && matchesExit(exitPending.payload)) finishExit();
        exitPending = undefined;
      } else {
        pendingChunks.length = 0;
        release();
      }
    }

    if (!isTerminalLive()) return;
    setIsConnecting(false);
    terminal.focus();
  } catch (error) {
    const owned = ownsConnection();
    releaseConnection?.();
    if (!owned) return;
    log.error("Failed to create/connect PTY session:", error);
    setIsConnecting(false);
    const liveTerminal = terminalRef.current;
    if (liveTerminal) {
      try {
        liveTerminal.writeln(
          "\x1b[31mFailed to connect to system terminal\x1b[0m"
        );
        liveTerminal.writeln(`\x1b[90mError: ${error}\x1b[0m`);
      } catch (writeError) {
        log.warn("[TerminalView] Failed to render PTY error:", writeError);
      }
    }
  }
}
