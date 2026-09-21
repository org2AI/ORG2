/**
 * Execution-target discovery for a canonical conversation: enumerate durable
 * execution episodes, read their runtime identity, and select the newest
 * target-compatible episode whose native history is still a canonical prefix.
 */
import { getSession as getAgentSession } from "@src/api/tauri/agent";
import { rpc } from "@src/api/tauri/rpc";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { loadAuthoritativeSessionEvents } from "@src/engines/SessionCore/sync/authoritativeSessionEvents";
import { createLogger } from "@src/hooks/logger";
import { invokeTauri } from "@src/util/platform/tauri/init";
import {
  isAgentSession,
  isCliSession,
} from "@src/util/session/sessionDispatch";

import {
  type ConversationRootLocator,
  type LocalConversationTarget,
  isLocalConversationTarget,
} from "./conversationTypes";
import { conversationExecutionParentId } from "./localConversationExecutionIdentity";
import {
  nativeConversationItemsAreProviderPortablePrefix,
  projectNativeConversationItems,
} from "./nativeConversationMaterializer";
import {
  QueuedConversationRecoveryBlockedError,
  QueuedConversationRecoveryPendingError,
} from "./queuedConversationContract";
import { effectiveQueuedRetryEvents } from "./queuedRetryLineage";

const log = createLogger("localConversationContinuation");

interface ChildSessionView {
  sessionId: string;
  updatedAt: string;
}

export interface ExecutionCandidate {
  sessionId: string;
  updatedAt: string;
}

/**
 * Read-only execution identity persisted by the normal Session owner.
 *
 * This is intentionally only a projection of existing Session rows. It is
 * not another continuation registry: callers use it to hydrate picker state
 * after restart, while execution and resume continue to use those same rows.
 */
export interface LocalConversationExecutionTargetSnapshot {
  sessionId: string;
  updatedAt: string;
  target: LocalConversationTarget;
}

async function listExecutionChildren(
  parentSessionId: string
): Promise<ExecutionCandidate[]> {
  const children = await invokeTauri<ChildSessionView[]>(
    "es_get_child_sessions",
    { parentSessionId }
  );
  return children
    .filter(
      (child) =>
        typeof child.sessionId === "string" && child.sessionId.length > 0
    )
    .map((child) => ({
      sessionId: child.sessionId,
      updatedAt: child.updatedAt,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function listExecutionCandidates(
  locator: ConversationRootLocator
): Promise<ExecutionCandidate[]> {
  const children = await listExecutionChildren(
    conversationExecutionParentId(locator)
  );
  const canOwnLocalExecution =
    locator.authority === "local-session" ||
    (locator.authority === "org2-cloud" &&
      (isCliSession(locator.conversationId) ||
        isAgentSession(locator.conversationId)));
  if (!canOwnLocalExecution) return children;

  // The ordinary source Session is already a fully native execution episode.
  // Include it next to provider-switch children so returning to the source
  // provider reuses its native UUID instead of creating a duplicate copy.
  // Sharing changes the conversation authority, not the owner's execution
  // identity. On a receiving device this source has no local execution row;
  // only its own children can contribute account identities there.
  let root: ExecutionRow | null;
  try {
    root = await readExecutionRow(locator.conversationId);
  } catch (error) {
    throw new QueuedConversationRecoveryPendingError(
      `source execution identity is temporarily unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!root?.updatedAt) return children;
  // Sharing can promote the locator after an owner already switched runtime.
  // Those durable children still belong to its local root. Consult that
  // namespace only after the owner's actual execution row was found above;
  // a receiving device must never infer the remote owner's account history.
  const beforeSharingChildren =
    locator.authority === "org2-cloud"
      ? await listExecutionChildren(
          conversationExecutionParentId({
            authority: "local-session",
            authorityScope: [],
            conversationId: locator.conversationId,
          })
        )
      : [];
  const candidates = new Map<string, ExecutionCandidate>();
  for (const candidate of [
    { sessionId: locator.conversationId, updatedAt: root.updatedAt },
    ...children,
    ...beforeSharingChildren,
  ]) {
    const previous = candidates.get(candidate.sessionId);
    if (!previous || candidate.updatedAt > previous.updatedAt) {
      candidates.set(candidate.sessionId, candidate);
    }
  }
  return [...candidates.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

function sameOptional(left: unknown, right: string | undefined): boolean {
  return (
    (typeof left === "string" && left.length > 0 ? left : undefined) === right
  );
}

function comparableWorkspacePath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  let normalized = value
    .trim()
    .replace(/^file:\/\//, "")
    .replace(/\/+$/, "");
  if (!normalized) return undefined;
  // macOS exposes the same temporary filesystem through both spellings.
  // Agent session rows are canonicalized by Rust to /private/tmp while the
  // New Session/workspace picker can retain the user-facing /tmp spelling.
  // Treating that alias as a runtime identity change creates an unnecessary
  // child episode and moves the live answer off the visible owner stream.
  if (normalized === "/private/tmp") normalized = "/tmp";
  else if (normalized.startsWith("/private/tmp/")) {
    normalized = normalized.slice("/private".length);
  }
  return normalized;
}

function sameWorkspacePath(left: unknown, right: string | undefined): boolean {
  const requested = comparableWorkspacePath(right);
  // A missing target path is the automatic-workspace state used while a
  // shared/imported Session hydrates its local repo-scope match. For an
  // existing native episode, its durable repo path is already the verified
  // local choice and must be inherited. A concrete different path remains an
  // intentional isolation boundary and rolls to a new episode.
  return requested === undefined || comparableWorkspacePath(left) === requested;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

interface ExecutionRow {
  target: LocalConversationTarget;
  updatedAt?: string;
}

async function readExecutionRow(
  sessionId: string
): Promise<ExecutionRow | null> {
  if (isCliSession(sessionId)) {
    const row = (await rpc.cli.status({ sessionId })) as Record<
      string,
      unknown
    > | null;
    if (!row) return null;
    const cliAgentType = optionalString(row.cliAgentType);
    const accountId = optionalString(row.accountId);
    const credentialSource = optionalString(row.credentialSource);
    const updatedAt = optionalString(row.updatedAt);
    if (
      !cliAgentType ||
      (!accountId && !credentialSource && cliAgentType !== "claude_code")
    ) {
      return null;
    }
    const target = {
      cliAgentType,
      accountId,
      credentialSource,
      model: optionalString(row.model),
      workspaceRepoPath:
        optionalString(row.worktreePath) ?? optionalString(row.repoPath),
    };
    if (
      row.credentialSource != null &&
      (!credentialSource || !isLocalConversationTarget(target))
    )
      return null;
    return { target, updatedAt };
  }

  const row = await getAgentSession(sessionId);
  if (!row) return null;
  const agentDefinitionId = optionalString(row.agentDefinitionId);
  const accountId = optionalString(row.accountId);
  const model = optionalString(row.model);
  const updatedAt = optionalString(row.updatedAt);
  const target = {
    agentDefinitionId,
    accountId,
    credentialSource: row.credentialSource ?? undefined,
    model,
    workspaceRepoPath: optionalString(row.workspacePath),
  };
  return isLocalConversationTarget(target) ? { target, updatedAt } : null;
}

/**
 * Load every durable execution target for a canonical conversation, newest
 * first. Hidden continuation children are deliberately read through
 * `es_get_child_sessions`; they are not required to be present in the UI's
 * in-memory Session roster.
 */
export async function loadLocalConversationExecutionTargets(
  locator: ConversationRootLocator
): Promise<LocalConversationExecutionTargetSnapshot[]> {
  const candidates = await listExecutionCandidates(locator);
  const rows = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      row: await readExecutionRow(candidate.sessionId),
    }))
  );
  return rows
    .flatMap(({ candidate, row }) =>
      row
        ? [
            {
              sessionId: candidate.sessionId,
              updatedAt: row.updatedAt ?? candidate.updatedAt,
              target: row.target,
            },
          ]
        : []
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function candidateMatchesTarget(
  sessionId: string,
  target: LocalConversationTarget
): Promise<boolean> {
  const existing = (await readExecutionRow(sessionId))?.target ?? null;
  if (!existing) {
    log.info(
      `[native-continuation] skipping ${sessionId}: execution identity is unavailable`
    );
    return false;
  }
  // A model is a per-turn launch choice, not provider conversation identity.
  // The ordinary composer can already change models while preserving one
  // Session/native UUID. Treating it as an episode fingerprint caused a
  // Codex -> Claude -> Codex round trip to clone the original Codex
  // conversation whenever the picker selected a different compatible Codex
  // model on return. Runtime/profile/workspace still define the isolation
  // boundary; the selected model is passed to `sendMessage` below.
  const matches =
    sameOptional(existing.cliAgentType, target.cliAgentType) &&
    sameWorkspacePath(
      existing.workspaceRepoPath,
      target.workspaceRepoPath ?? undefined
    ) &&
    sameOptional(existing.accountId, target.accountId) &&
    sameOptional(existing.credentialSource, target.credentialSource) &&
    sameOptional(existing.agentDefinitionId, target.agentDefinitionId);
  if (!matches) {
    log.info(
      `[native-continuation] skipping ${sessionId}: runtime identity does not match`,
      {
        existingRuntime: existing.cliAgentType ?? existing.agentDefinitionId,
        requestedRuntime: target.cliAgentType ?? target.agentDefinitionId,
        accountMatches: sameOptional(existing.accountId, target.accountId),
        workspaceMatches: sameWorkspacePath(
          existing.workspaceRepoPath,
          target.workspaceRepoPath ?? undefined
        ),
        existingWorkspace: comparableWorkspacePath(existing.workspaceRepoPath),
        requestedWorkspace: comparableWorkspacePath(
          target.workspaceRepoPath ?? undefined
        ),
      }
    );
  }
  return matches;
}

export async function findCompatibleExecution(
  locator: ConversationRootLocator,
  target: LocalConversationTarget,
  timeline: readonly SessionEvent[],
  knownMatchingCandidates?: readonly ExecutionCandidate[]
): Promise<{
  sessionId: string;
  events: SessionEvent[];
} | null> {
  const canonicalItems = projectNativeConversationItems(timeline);
  const availableCandidates =
    knownMatchingCandidates ?? (await listExecutionCandidates(locator));
  // Candidates are newest-first. A provider switch makes the global frontier
  // belong to another runtime, but it does not invalidate the earlier native
  // UUID for this target. Reuse the newest target-compatible episode whose
  // native history is still a canonical prefix; synchronization below appends
  // the intervening cross-runtime delta before the next provider send.
  for (const candidate of availableCandidates) {
    if (
      !knownMatchingCandidates &&
      !(await candidateMatchesTarget(candidate.sessionId, target))
    ) {
      continue;
    }
    try {
      const loaded = await loadAuthoritativeSessionEvents(candidate.sessionId);
      const events = loaded.events;
      const executionItems = projectNativeConversationItems(events);
      const effectiveEvents = effectiveQueuedRetryEvents(events, timeline);
      const containsSupersededPrompt = effectiveEvents.length !== events.length;
      // A newly-created child may legitimately be empty if the renderer died
      // between Session creation and native materialization. Empty is the
      // canonical zero-length prefix: synchronizeNativeConversation rebuilds
      // the provider transcript before sending the same durable turn intent.
      if (
        !containsSupersededPrompt &&
        nativeConversationItemsAreProviderPortablePrefix(
          executionItems,
          canonicalItems
        )
      ) {
        return {
          sessionId: candidate.sessionId,
          events,
        };
      }
      if (
        containsSupersededPrompt &&
        nativeConversationItemsAreProviderPortablePrefix(
          projectNativeConversationItems(effectiveEvents),
          canonicalItems
        )
      ) {
        // Check durable retry identity even when the raw text is a prefix:
        // an old failed prompt can have exactly the retried prompt's text.
        // Resuming it would append only the successful assistant and bind it
        // to the superseded user. Leave that audit intact and use an episode
        // without the superseded prompt (or materialize a fresh one).
        continue;
      }
      // A compatible execution may contain unpublished partial/tool output.
      // Selecting an older UUID (or creating a fresh one) would silently omit
      // that output on Retry just as surely as ignoring the synchronizer's
      // prefix error. Explicit forks have their own root; an unexplained
      // branch inside this root requires reconciliation before another send.
      throw new QueuedConversationRecoveryBlockedError(
        `native history for ${candidate.sessionId} differs from the canonical conversation (native=${executionItems.length}, canonical=${canonicalItems.length}); reconcile the missing history before retrying`
      );
    } catch (error) {
      if (
        error instanceof QueuedConversationRecoveryPendingError ||
        error instanceof QueuedConversationRecoveryBlockedError
      ) {
        throw error;
      }
      // An unknown reader failure cannot prove that this episode is absent or
      // divergent. Fail closed and retry instead of silently selecting an
      // older provider-native UUID whose relative history is unknown.
      throw new QueuedConversationRecoveryPendingError(
        `native transcript for ${candidate.sessionId} is temporarily unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  return null;
}
