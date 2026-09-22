import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type React from "react";

import { IMPORTED_HISTORY_SOURCE_DESCRIPTORS } from "@src/api/tauri/externalHistory/imported/descriptors";
import AnyIcon from "@src/components/AnyIcon";
import { HOVER_CARD } from "@src/components/HoverCard/tokens";
import { resolveAgentIcon } from "@src/config/agentIcons";
import { createLogger } from "@src/hooks/logger";
import { tildePath } from "@src/util/path";
import type { SessionDisplayMetadata } from "@src/util/session/sessionDisplayMetadata";

const logger = createLogger("SessionHoverCard");

export interface AgentSessionInfo {
  icon: React.ReactNode;
  label: string;
  textClassName?: string;
}

/** Mirror of the `cli_agent_transcript_path` command payload. */
export interface CliTranscriptLocation {
  /** True when the transcript of record lives in the CLI's native store. */
  native: boolean;
  /** Resolved native store path, when the imported-history cache has it. */
  path: string | null;
}

/**
 * Minimal mirror of the `cli_agent_status` command payload (`CodeSession`,
 * camelCase). Only the bound native CLI id is read here.
 */
export interface CliAgentStatusPayload {
  /** The CLI's own session id (e.g. Claude jsonl stem), once bound. */
  cliSessionId?: string | null;
}

export const PATH_ROW_CLASS_NAME =
  "block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-left text-text-2 underline-offset-2 transition-colors hover:text-accent-9 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-8";
/** Inline link used for text that sits beside other text inside a row. */
export const INLINE_LINK_CLASS_NAME =
  "text-text-2 underline-offset-2 transition-colors hover:text-accent-9 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-8";
/** Trailing icon-only affordance that reveals a path in the file manager. */
export const REVEAL_ICON_BUTTON_CLASS_NAME =
  "flex shrink-0 items-center rounded text-text-4 transition-colors hover:text-accent-9 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-8";
const COMPACT_PATH_MAX_CHARS = 44;

export function formatCompactPath(path: string): string {
  const compactPath = tildePath(path);
  if (compactPath.length <= COMPACT_PATH_MAX_CHARS) return compactPath;

  const parts = compactPath.split("/").filter(Boolean);
  if (parts.length <= 3) return compactPath;

  const prefix = compactPath.startsWith("~/") ? "~/" : "/";
  const start = compactPath.startsWith("~/")
    ? parts[0]
    : parts.slice(0, 2).join("/");
  const endParts = parts.slice(-2);
  const end = endParts.join("/");
  const candidate = `${prefix}${start === "~" ? "" : `${start}/`}.../${end}`;

  if (candidate.length <= COMPACT_PATH_MAX_CHARS) return candidate;
  return `${prefix}.../${parts.at(-1) ?? compactPath}`;
}

export function normalizePath(path: string): string {
  return path.replace(/\/+$/u, "");
}

/**
 * Strip the imported-history prefix (`claudecodeapp-`, `codexapp-`,
 * `cursoride-`, ...) and return the RAW source-store session id — the value
 * that matches the CLI's own tooling (Claude jsonl stem, Codex rollout id,
 * opencode `ses_` id, Cursor composer UUID). Returns `null` for
 * non-imported sessions.
 */
export function getImportedRawSessionId(sessionId: string): string | null {
  for (const descriptor of IMPORTED_HISTORY_SOURCE_DESCRIPTORS) {
    if (sessionId.startsWith(descriptor.prefix)) {
      const raw = sessionId.slice(descriptor.prefix.length);
      return raw.length > 0 ? raw : null;
    }
  }
  return null;
}

export function handleRevealPath(path: string): void {
  void revealItemInDir(path).catch((error: unknown) => {
    logger.warn("failed to reveal session path", { error, path });
  });
}

export function getAgentSessionInfo(
  display: SessionDisplayMetadata
): AgentSessionInfo {
  const agentIcon = resolveAgentIcon(display.agentIconId);

  return {
    icon: (
      <AnyIcon
        icon={agentIcon}
        size={HOVER_CARD.iconSize}
        strokeWidth={HOVER_CARD.iconStrokeWidth}
      />
    ),
    label: display.agentLabel,
    textClassName: "text-text-1",
  };
}
