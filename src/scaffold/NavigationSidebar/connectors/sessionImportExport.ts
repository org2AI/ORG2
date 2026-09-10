import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { TFunction } from "i18next";
import { z } from "zod/v4";

import { cursorIdeFullRefresh } from "@src/api/tauri/externalHistory";
import type { DispatchCategory } from "@src/api/tauri/session";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { processChunksRust } from "@src/engines/SessionCore/ingestion/rustBridge";
import { cacheAdapter } from "@src/engines/SessionCore/storage/cacheAdapter";
import { loadOwnSessionInitialEvents } from "@src/engines/SessionCore/sync/sessionSyncUtils";
import type { Session } from "@src/store/session";
import type { ActivityChunk } from "@src/types/session/session";
import {
  isAgentSession,
  isCliSession,
  isCursorIdeSession,
} from "@src/util/session/sessionDispatch";
import { getSessionListDisplayName } from "@src/util/session/sessionSidebarRow";

const EXPORT_FORMAT = "orgii.session.export";
const EXPORT_VERSION = 1;
const FILENAME_UNSAFE_CHARS = /[/\\?%*:|"<>]/g;

const SessionExportFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.string(),
  session: z.object({
    session_id: z.string(),
    status: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    completed_at: z.string().optional(),
    user_input: z.string().optional(),
    repo_name: z.string().optional(),
    name: z.string().optional(),
    branch: z.string().optional(),
    category: z.enum(["cli_agent", "rust_agent", "cursor_ide"]).optional(),
    cliAgentType: z.string().optional(),
    model: z.string().optional(),
    repoPath: z.string().optional(),
    worktreePath: z.string().optional(),
    worktreeBranch: z.string().optional(),
    baseBranch: z.string().optional(),
    background: z.boolean().optional(),
    workItemId: z.string().optional(),
    agentRole: z.string().optional(),
    agentDefinitionId: z.string().optional(),
    agentIconId: z.string().optional(),
    agentDisplayName: z.string().optional(),
    agentExecMode: z.string().optional(),
    pinned: z.boolean().optional(),
    created_time: z.string().optional(),
    updated_time: z.string().optional(),
  }),
  metadata: z.object({
    originalCategory: z.enum(["cli_agent", "rust_agent", "cursor_ide"]),
    eventCount: z.number(),
  }),
  payload: z.object({
    events: z.array(z.record(z.string(), z.unknown())),
    specs: z.array(z.unknown()).optional(),
    timeRange: z
      .object({
        start: z.string(),
        end: z.string(),
      })
      .optional(),
  }),
});

type SessionExportFile = z.output<typeof SessionExportFileSchema>;

export interface SessionExportPreview {
  sessionId: string;
  displayName: string;
  category: DispatchCategory;
  eventCount: number;
  fileName: string;
  exportedAt: string;
}

export interface SessionExportDraft {
  file: SessionExportFile;
  preview: SessionExportPreview;
}

type ExportableCategory = "cli_agent" | "rust_agent" | "cursor_ide";

function inferCategory(
  sessionId: string,
  explicit?: DispatchCategory
): ExportableCategory {
  if (
    explicit === "cli_agent" ||
    explicit === "rust_agent" ||
    explicit === "cursor_ide"
  )
    return explicit;
  if (isCursorIdeSession(sessionId)) return "cursor_ide";
  if (isCliSession(sessionId)) return "cli_agent";
  return "rust_agent";
}

function sanitizeFileName(value: string): string {
  const sanitized = value.replace(FILENAME_UNSAFE_CHARS, "-").trim();
  return (sanitized || "session").slice(0, 60);
}

function buildExportFileName(session: Session, fallback: string): string {
  const displayName = getSessionListDisplayName(session, fallback);
  return `${sanitizeFileName(displayName)}.orgii-session.json`;
}

function parseEventDate(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function getTimeRange(events: SessionEvent[], session: Session) {
  const eventTimes = events
    .map((event) => parseEventDate(event.createdAt))
    .filter((timestamp): timestamp is number => timestamp !== null);
  const start = eventTimes.length
    ? new Date(Math.min(...eventTimes)).toISOString()
    : session.created_at;
  const end = eventTimes.length
    ? new Date(Math.max(...eventTimes)).toISOString()
    : session.updated_at;
  return { start, end };
}

function cloneSessionForExport(session: Session): SessionExportFile["session"] {
  return {
    session_id: session.session_id,
    status: String(session.status),
    created_at: session.created_at,
    updated_at: session.updated_at,
    completed_at: session.completed_at,
    user_input: session.user_input,
    repo_name: session.repo_name,
    name: session.name,
    branch: session.branch,
    category: inferCategory(session.session_id, session.category),
    cliAgentType: session.cliAgentType,
    model: session.model,
    repoPath: session.repoPath,
    worktreePath: session.worktreePath,
    worktreeBranch: session.worktreeBranch,
    baseBranch: session.baseBranch,
    background: session.background,
    workItemId: session.workItemId,
    agentRole: session.agentRole,
    agentDefinitionId: session.agentDefinitionId,
    agentIconId: session.agentIconId,
    agentDisplayName: session.agentDisplayName,
    agentExecMode: session.agentExecMode,
    pinned: session.pinned,
    created_time: session.created_time,
    updated_time: session.updated_time,
  };
}

async function loadSessionEventsForExport(
  session: Session
): Promise<SessionEvent[]> {
  const sessionId = session.session_id;
  if (isCursorIdeSession(sessionId)) {
    const refresh = await cursorIdeFullRefresh(sessionId);
    return processChunksRust(refresh.chunks, sessionId);
  }

  if (isCliSession(sessionId)) {
    const chunks = await tauriInvoke<ActivityChunk[]>("cli_agent_chunks", {
      sessionId,
    });
    return processChunksRust(chunks, sessionId);
  }

  if (isAgentSession(sessionId)) {
    return loadOwnSessionInitialEvents(sessionId);
  }

  const fullSession = await cacheAdapter.loadFullSession(sessionId);
  if (fullSession) return fullSession.events;
  return cacheAdapter.loadEvents(sessionId);
}

export async function buildSessionExportDraft(
  session: Session,
  fallback: string
): Promise<SessionExportDraft> {
  const events = await loadSessionEventsForExport(session);
  const exportedAt = new Date().toISOString();
  const category = inferCategory(session.session_id, session.category);
  const fileName = buildExportFileName(session, fallback);
  const file: SessionExportFile = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt,
    session: cloneSessionForExport(session),
    metadata: {
      originalCategory: category,
      eventCount: events.length,
    },
    payload: {
      events: events as unknown as Record<string, unknown>[],
      specs: [],
      timeRange: getTimeRange(events, session),
    },
  };
  return {
    file,
    preview: {
      sessionId: session.session_id,
      displayName: getSessionListDisplayName(session, fallback),
      category,
      eventCount: events.length,
      fileName,
      exportedAt,
    },
  };
}

export function formatCategoryLabel(
  category: DispatchCategory,
  t: TFunction<"sessions">
): string {
  switch (category) {
    case "cli_agent":
      return t("chat.importExport.categories.cli");
    case "rust_agent":
      return t("chat.importExport.categories.rust");
    case "human_session":
      return t("chat.importExport.categories.human", {
        defaultValue: "Work log",
      });
    case "cursor_ide":
      return t("chat.importExport.categories.cursorIde");
    case "external_history":
      return t("chat.importExport.categories.externalHistory");
    default:
      return category;
  }
}

export function formatEventCount(
  count: number,
  t: TFunction<"sessions">
): string {
  return t("chat.eventCount", { count });
}

export function stringifySessionExportFile(payload: SessionExportFile): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export const SESSION_JSON_FILTER = {
  name: "ORGII Session JSON",
  extensions: ["json"],
};
