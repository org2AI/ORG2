/**
 * Provider-neutral local continuation for one canonical conversation.
 *
 * The canonical transcript can come from Cloud, an imported session, or a
 * normal local Session. Execution always happens on this device with the
 * caller's selected local runtime/account/workspace. A normal persisted
 * Session is the continuation record: `parentSessionId` groups its hidden
 * execution episodes under a deterministic conversation parent, so no
 * localStorage runner registry or parallel continuation database is needed.
 */
import { getSession as getAgentSession } from "@src/api/tauri/agent";
import { rpc } from "@src/api/tauri/rpc";
import {
  beginOptimisticTurn,
  failOptimisticTurn,
} from "@src/engines/SessionCore/control/optimisticTurnStatus";
import {
  type TurnTerminalStatus,
  beginTurnDispatch,
  confirmTurnRunning,
  markTurnTerminal,
  toTurnTerminalStatus,
} from "@src/engines/SessionCore/control/turnLifecycle";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import {
  type UserIntentPreparation,
  UserIntentSendError,
  activateUserIntentPreparation,
  clearParkedUserIntentEvent,
  confirmUserIntentPreparation,
  dispatchUserIntent,
  failUserIntentPreparation,
  isUserIntentSendError,
  prepareUserIntent,
} from "@src/engines/SessionCore/services/userIntentDispatch";
import { loadAuthoritativeSessionEvents } from "@src/engines/SessionCore/sync/authoritativeSessionEvents";
import { turnIntentIdOf } from "@src/engines/SessionCore/sync/utils/activityIds";
import { createLogger } from "@src/hooks/logger";
import { setSessionRuntimeStatusAtom } from "@src/store/session/cliSessionStatusAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { invokeTauri } from "@src/util/platform/tauri/init";
import { isCliSession } from "@src/util/session/sessionDispatch";

import type {
  ConversationRootLocator,
  LocalConversationTarget,
} from "./conversationTypes";
import {
  materializeNativeConversation,
  nativeConversationItemsArePrefix,
  projectNativeConversationItems,
  supportsNativeConversationTarget,
  synchronizeNativeConversation,
} from "./nativeConversationMaterializer";

export type {
  ConversationRootLocator,
  LocalConversationTarget,
} from "./conversationTypes";

const TRANSCRIPT_SETTLE_MS = 5_000;
const INTERRUPTED_TRANSCRIPT_SETTLE_MS = 800;
const TRANSCRIPT_SETTLE_INITIAL_POLL_MS = 100;
const TRANSCRIPT_SETTLE_MAX_POLL_MS = 1_000;
const TURN_WAIT_WINDOW_MS = 60_000;
const log = createLogger("localConversationContinuation");

async function notifyConversationTurnAccepted(
  callback: ContinueLocalConversationParams["onTurnAccepted"],
  sessionId: string,
  turnIntentId: string
): Promise<void> {
  if (!callback) return;
  try {
    await callback(sessionId);
  } catch (error) {
    // Provider acceptance is already durable. A local receipt/bookkeeping
    // failure must not reclassify the send as rejected or skip waiting for the
    // real native tail; recovery can reconcile the same turnIntentId later.
    log.error(
      `[native-continuation] failed to persist acceptance receipt for ${turnIntentId}`,
      error
    );
  }
}

export const CONVERSATION_TURN_ID_ARG = "conversationTurnId";

interface ContinueLocalConversationParams {
  root: ConversationRootLocator;
  title: string;
  /** Canonical transcript immediately before this new user turn. */
  timeline: readonly SessionEvent[];
  displayText: string;
  agentContent?: string;
  imageDataUrls?: string[];
  target: LocalConversationTarget;
  turnIntentId: string;
  /** Runs after the singleton queue grants this conversation its turn. */
  beforeDispatch?: () => void | Promise<void>;
  onSessionReady?: (
    sessionId: string,
    /** Authoritative native-event prefix that predates this turn. */
    eventStartIndex: number
  ) => void | Promise<void>;
  /**
   * Fires once the selected provider has durably accepted this user turn.
   * Queue ownership lives above the continuation adapter: callers use this
   * boundary to remove the durable queue row while the native turn keeps
   * running and reconciling in the background.
   */
  onTurnAccepted?: (sessionId: string) => void | Promise<void>;
  /**
   * A fresh episode now owns preparation, before its canonical transcript has
   * finished materializing. Surfaces use this to bind the ordinary planning
   * footer immediately without overlaying historical events.
   */
  onSessionPreparing?: (sessionId: string) => void | Promise<void>;
}

interface ContinueLocalConversationAfterTimelineLoadParams extends Omit<
  ContinueLocalConversationParams,
  "timeline"
> {
  /**
   * Read the authoritative canonical transcript only after this conversation
   * reaches the head of the singleton message queue. This prevents a submit made
   * immediately after Stop from racing the previous turn's native-tail
   * reconciliation and materializing a stale prefix into the next runtime.
   */
  loadTimeline: () => Promise<readonly SessionEvent[]>;
}

export interface ContinueLocalConversationResult {
  sessionId: string;
  created: boolean;
  terminalStatus: TurnTerminalStatus;
  agentTail: SessionEvent[];
}

interface RecoverLocalConversationParams extends Omit<
  ContinueLocalConversationParams,
  "beforeDispatch"
> {
  runnerSessionId: string;
  eventStartIndex?: number;
}

type ConversationTurnPreparation = UserIntentPreparation;

interface ChildSessionView {
  sessionId: string;
  updatedAt: string;
}

interface ExecutionCandidate {
  sessionId: string;
  updatedAt: string;
}

function requireIdentityPart(label: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`conversation ${label} is required`);
  if (normalized.length > 2_048) {
    throw new Error(`conversation ${label} is too long`);
  }
  return normalized;
}

/** Durable grouping id stored directly on normal native/CLI Session rows. */
export function conversationExecutionParentId(
  locator: ConversationRootLocator
): string {
  if (locator.authorityScope.length > 16) {
    throw new Error("conversation authority scope has too many parts");
  }
  return JSON.stringify([
    "org2-conversation",
    1,
    requireIdentityPart("authority", locator.authority),
    locator.authorityScope.map((part, index) =>
      requireIdentityPart(`authority scope ${index}`, part)
    ),
    requireIdentityPart("id", locator.conversationId),
  ]);
}

/** Parse only parent ids emitted by `conversationExecutionParentId`. */
export function parseConversationExecutionParentId(
  value: string | null | undefined
): ConversationRootLocator | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 5 ||
      parsed[0] !== "org2-conversation" ||
      parsed[1] !== 1 ||
      typeof parsed[2] !== "string" ||
      !Array.isArray(parsed[3]) ||
      !parsed[3].every((part) => typeof part === "string") ||
      typeof parsed[4] !== "string"
    ) {
      return null;
    }
    return {
      authority: parsed[2],
      authorityScope: parsed[3] as string[],
      conversationId: parsed[4],
    };
  } catch {
    return null;
  }
}

/**
 * Promote a normal readable My Session to a canonical conversation root.
 * Target support is checked separately: any native transcript may be a source,
 * while only runtimes with a verified writer/reader adapter may execute it.
 */
export function localConversationRootForSession(
  sessionId: string,
  cliAgentType: string | null | undefined,
  agentDefinitionId?: string | null
): ConversationRootLocator | null {
  if (isCliSession(sessionId)) {
    if (!cliAgentType) return null;
  } else if (!agentDefinitionId) {
    return null;
  }
  return {
    authority: "local-session",
    authorityScope: [],
    conversationId: sessionId,
  };
}

function eventTurnId(event: SessionEvent): string | null {
  const turnIntentId = turnIntentIdOf(event);
  if (turnIntentId) return turnIntentId;
  const value = event.args?.[CONVERSATION_TURN_ID_ARG];
  return typeof value === "string" && value.length > 0 ? value : null;
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

async function listExecutionCandidates(
  locator: ConversationRootLocator
): Promise<ExecutionCandidate[]> {
  const children = await listExecutionChildren(
    conversationExecutionParentId(locator)
  );
  if (locator.authority !== "local-session") return children;

  // The ordinary source Session is already a fully native execution episode.
  // Include it next to provider-switch children so returning to the source
  // provider reuses its native UUID instead of creating a duplicate copy.
  const root = await readExecutionRow(locator.conversationId).catch(() => null);
  if (!root?.updatedAt) return children;
  return [
    {
      sessionId: locator.conversationId,
      updatedAt: root.updatedAt,
    },
    ...children,
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
  sessionId: string,
  _options: { allowFailed?: boolean } = {}
): Promise<ExecutionRow | null> {
  if (isCliSession(sessionId)) {
    const row = (await rpc.cli.status({ sessionId })) as Record<
      string,
      unknown
    > | null;
    if (!row) return null;
    const cliAgentType = optionalString(row.cliAgentType);
    const accountId = optionalString(row.accountId);
    const updatedAt = optionalString(row.updatedAt);
    if (!cliAgentType || (!accountId && cliAgentType !== "claude_code")) {
      return null;
    }
    return {
      target: {
        cliAgentType,
        accountId,
        model: optionalString(row.model),
        workspaceRepoPath:
          optionalString(row.worktreePath) ?? optionalString(row.repoPath),
      },
      updatedAt,
    };
  }

  const row = await getAgentSession(sessionId);
  if (!row) return null;
  const agentDefinitionId = optionalString(row.agentDefinitionId);
  const accountId = optionalString(row.accountId);
  const model = optionalString(row.model);
  const updatedAt = optionalString(row.updatedAt);
  if (!agentDefinitionId || !accountId || !model) return null;
  return {
    target: {
      agentDefinitionId,
      accountId,
      model,
      workspaceRepoPath: optionalString(row.workspacePath),
    },
    updatedAt,
  };
}

async function readExecutionTarget(
  sessionId: string
): Promise<LocalConversationTarget | null> {
  return (await readExecutionRow(sessionId))?.target ?? null;
}

async function candidateMatchesTarget(
  sessionId: string,
  target: LocalConversationTarget,
  options: { allowFailed?: boolean } = {}
): Promise<boolean> {
  const existing = options.allowFailed
    ? ((await readExecutionRow(sessionId, options))?.target ?? null)
    : await readExecutionTarget(sessionId);
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

async function findCompatibleExecution(
  locator: ConversationRootLocator,
  target: LocalConversationTarget,
  timeline: readonly SessionEvent[],
  knownMatchingCandidates?: readonly ExecutionCandidate[]
): Promise<{
  sessionId: string;
  updatedAt: string;
  events: SessionEvent[];
} | null> {
  const canonicalItems = projectNativeConversationItems(timeline);
  const availableCandidates =
    knownMatchingCandidates ?? (await listExecutionCandidates(locator));
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
      if (nativeConversationItemsArePrefix(executionItems, canonicalItems)) {
        return {
          sessionId: candidate.sessionId,
          updatedAt: candidate.updatedAt,
          events,
        };
      }
      log.info(
        `[native-continuation] skipping ${candidate.sessionId}: native transcript is not a canonical prefix`,
        {
          nativeItems: executionItems.length,
          canonicalItems: canonicalItems.length,
        }
      );
    } catch (error) {
      // A missing/corrupt native transcript is not resumable. Try an older
      // compatible episode before creating a fresh one.
      log.warn(
        `[native-continuation] skipping ${candidate.sessionId}: native transcript read failed`,
        error
      );
    }
  }
  return null;
}

/**
 * Keep EventStore's render/cache projection aligned after a target-native
 * episode has been synchronized from the canonical SessionEvent log. The
 * provider file is only that episode's execution format; the verified
 * canonical projection remains the conversation authority.
 */
async function hydrateSynchronizedConversationProjection(
  sessionId: string,
  before: readonly SessionEvent[],
  after: readonly SessionEvent[]
): Promise<void> {
  if (before.length === after.length && sameEventPrefix(before, after)) return;
  if (sameEventPrefix(before, after)) {
    await eventStoreProxy.mergeEvents(after.slice(before.length), sessionId);
    return;
  }
  await eventStoreProxy.set([...after], sessionId);
}

async function waitForTurnTerminal(
  sessionId: string,
  turnIntentId: string
): Promise<TurnTerminalStatus> {
  for (;;) {
    try {
      const terminal = await rpc.sessionCore.turnIntents.waitForTerminal({
        sessionId,
        turnIntentId,
        timeoutMs: TURN_WAIT_WINDOW_MS,
      });
      log.info(
        `[native-continuation] durable turn intent ${turnIntentId}: ${terminal.status}`
      );
      return toTurnTerminalStatus(terminal.status);
    } catch (error) {
      // A bounded long-poll timeout is not a turn timeout. Re-read the exact
      // durable row and open another window while the provider owns it.
      const current = await rpc.sessionCore.turnIntents.status({
        sessionId,
        turnIntentId,
      });
      if (
        current &&
        ["optimistic", "queued", "running"].includes(current.status)
      ) {
        continue;
      }
      if (current) {
        return toTurnTerminalStatus(current.status);
      }
      throw error;
    }
  }
}

function sameEventPrefix(
  before: readonly SessionEvent[],
  after: readonly SessionEvent[]
): boolean {
  return (
    before.length <= after.length &&
    before.every((event, index) => event.id === after[index]?.id)
  );
}

function sliceTurnTail(
  before: readonly SessionEvent[],
  after: readonly SessionEvent[],
  turnIntentId: string
): SessionEvent[] | null {
  let appended: readonly SessionEvent[];
  if (sameEventPrefix(before, after)) {
    appended = after.slice(before.length);
    const anchor = appended.findIndex(
      (event) => event.source === "user" && eventTurnId(event) === turnIntentId
    );
    if (anchor < 0) return null;
    appended = appended.slice(anchor + 1);
  } else {
    const anchor = after.findIndex(
      (event) => event.source === "user" && eventTurnId(event) === turnIntentId
    );
    if (anchor < 0) return null;
    appended = after.slice(anchor + 1);
  }
  return removeKnownNativeEchoes(
    before,
    appended.filter((event) => event.source !== "user")
  );
}

/**
 * EventStore can briefly contain a provider-native echo of a synchronized
 * prefix after the new user anchor. Never republish an item whose portable
 * native identity was already present before this turn.
 */
function removeKnownNativeEchoes(
  before: readonly SessionEvent[],
  candidates: readonly SessionEvent[]
): SessionEvent[] {
  const seen = new Set(
    projectNativeConversationItems(before).map((item) => item.id)
  );
  return candidates.filter((event) => {
    const items = projectNativeConversationItems([event]);
    if (items.length === 0) return true;
    const isKnown = items.every((item) => seen.has(item.id));
    for (const item of items) seen.add(item.id);
    return !isKnown;
  });
}

function nativeItemEventId(id: string): string {
  return id.replace(/:(?:call|result)$/, "");
}

/**
 * Provider-native transcripts cannot be required to persist ORG2's private
 * turn-intent id. After terminal, recover the structured native suffix by
 * proving that the complete pre-turn portable transcript is still an exact
 * semantic prefix, then locating the newly appended user message. This is a
 * role/tool transcript comparison; no history is rendered into a prompt.
 */
function sliceProviderNativeTail(
  before: readonly SessionEvent[],
  after: readonly SessionEvent[],
  expectedUserText: string
): SessionEvent[] | null {
  const beforeItems = projectNativeConversationItems(before);
  const afterItems = projectNativeConversationItems(after);
  if (!nativeConversationItemsArePrefix(beforeItems, afterItems)) {
    log.warn(
      `[native-continuation] native semantic prefix mismatch: before=${beforeItems.length}, after=${afterItems.length}`
    );
    return null;
  }

  const appendedItems = afterItems.slice(beforeItems.length);
  const userIndex = appendedItems.findIndex(
    (item) =>
      item.kind === "message" &&
      item.role === "user" &&
      (item.text === expectedUserText || item.text.endsWith(expectedUserText))
  );
  if (userIndex < 0) {
    log.warn(
      `[native-continuation] native suffix has no matching user anchor: appended=${appendedItems.length}`
    );
    return null;
  }

  const tailEventIds = new Set(
    appendedItems.slice(userIndex + 1).map((item) => nativeItemEventId(item.id))
  );
  if (tailEventIds.size === 0) return [];
  const tail = after.filter(
    (event) => event.source !== "user" && tailEventIds.has(event.id)
  );
  log.info(
    `[native-continuation] recovered provider-native tail: items=${tailEventIds.size}, events=${tail.length}`
  );
  return tail;
}

async function loadSettledTail(
  sessionId: string,
  before: readonly SessionEvent[],
  turnIntentId: string,
  expectedUserText: string,
  emptyTerminalSettleMs: number | null = null
): Promise<{ agentTail: SessionEvent[]; events: SessionEvent[] }> {
  const settleDeadline = Date.now() + TRANSCRIPT_SETTLE_MS;
  const emptyTerminalDeadline =
    emptyTerminalSettleMs === null
      ? null
      : Math.min(settleDeadline, Date.now() + emptyTerminalSettleMs);
  let checkedNativeAfterTerminal = false;
  let fallbackDelayMs = TRANSCRIPT_SETTLE_INITIAL_POLL_MS;
  for (;;) {
    // The target runtime's native transcript is the source for this episode's
    // newly produced output, but it is never the cross-runtime conversation
    // authority. EventStore reconciles the optimistic user row with the
    // provider user row and transfers that exact identity one-to-one
    // (including repeated equal text). Once this tail is published it becomes
    // part of the canonical SessionEvent log used by every later runtime.
    // The open Session already owns a windowed JS snapshot, so inspect that
    // reference instead of cloning the entire Rust store and reparsing the
    // provider transcript every 100ms. A cold/non-rendered caller keeps the
    // compatibility path.
    const snapshot = eventStoreProxy.getLatestSessionSnapshot(sessionId);
    const identifiedEvents = snapshot
      ? snapshot.chatEvents
      : await eventStoreProxy.getEvents(sessionId).catch(() => []);
    const tail = sliceTurnTail(before, identifiedEvents, turnIntentId);
    if (tail && tail.length > 0) {
      // Read the target-native transcript exactly once after the enriched
      // anchor settles. This captures the episode tail and refreshes native
      // app metadata; publishing that tail promotes it into canonical events.
      const { events } = await loadAuthoritativeSessionEvents(sessionId);
      return { agentTail: tail, events };
    }
    if (snapshot && !checkedNativeAfterTerminal) {
      checkedNativeAfterTerminal = true;
      log.info(
        `[native-continuation] reading terminal provider transcript for ${sessionId}`
      );
      const { events } = await loadAuthoritativeSessionEvents(sessionId);
      const nativeTail = sliceProviderNativeTail(
        before,
        events,
        expectedUserText
      );
      if (nativeTail && nativeTail.length > 0) {
        return { agentTail: nativeTail, events };
      }
    }
    if (!snapshot) {
      // Background/non-rendered continuations may have no JS snapshot. Their
      // provider reader can carry the intent marker itself, so retain the
      // established full-read fallback for that uncommon path.
      const { events } = await loadAuthoritativeSessionEvents(sessionId);
      const authoritativeTail = sliceTurnTail(before, events, turnIntentId);
      if (authoritativeTail && authoritativeTail.length > 0) {
        return { agentTail: authoritativeTail, events };
      }
      const nativeTail = sliceProviderNativeTail(
        before,
        events,
        expectedUserText
      );
      if (nativeTail && nativeTail.length > 0) {
        return { agentTail: nativeTail, events };
      }
    }
    if (emptyTerminalDeadline !== null && Date.now() >= emptyTerminalDeadline) {
      // A cancelled or failed durable terminal is a valid conversation
      // boundary even when the provider produced no portable assistant/tool
      // suffix. The accepted user row remains canonical; callers publish the
      // terminal status/error without retrying the provider turn.
      const { events } = await loadAuthoritativeSessionEvents(sessionId);
      return { agentTail: [], events };
    }
    if (Date.now() >= settleDeadline) {
      // Some non-rendered adapters can carry ORG2 identity themselves even
      // when EventStore has no resident snapshot. Preserve that fail-safe
      // without putting a full provider parse in the active polling loop.
      const { events } = await loadAuthoritativeSessionEvents(sessionId);
      const authoritativeTail = sliceTurnTail(before, events, turnIntentId);
      if (authoritativeTail && authoritativeTail.length > 0) {
        return { agentTail: authoritativeTail, events };
      }
      const nativeTail = sliceProviderNativeTail(
        before,
        events,
        expectedUserText
      );
      if (nativeTail && nativeTail.length > 0) {
        return { agentTail: nativeTail, events };
      }
      if (emptyTerminalDeadline !== null) return { agentTail: [], events };
      throw new Error(
        `conversation turn ${turnIntentId} is missing its native transcript anchor`
      );
    }
    // The EventStore already owns the session change channel. Wake as soon as
    // it publishes the terminal suffix; the exponentially backed-off timer is
    // only for providers whose native file flush is not accompanied by a
    // snapshot push. This keeps a hidden large Session from cloning/parsing
    // its complete transcript fifty times during the five-second settle
    // window.
    await new Promise<void>((resolve) => {
      let settled = false;
      const subscription: { dispose?: () => void } = {};
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        subscription.dispose?.();
        resolve();
      };
      const timer = setTimeout(finish, fallbackDelayMs);
      subscription.dispose = eventStoreProxy.subscribeSession(
        sessionId,
        finish
      );
      if (settled) subscription.dispose();
    });
    fallbackDelayMs = Math.min(
      fallbackDelayMs * 2,
      TRANSCRIPT_SETTLE_MAX_POLL_MS
    );
  }
}

function eventContent(event: SessionEvent): string {
  const result = event.result as Record<string, unknown> | undefined;
  const message = result?.message as Record<string, unknown> | undefined;
  for (const candidate of [
    message?.content,
    result?.content,
    result?.observation,
    result?.output,
    event.displayText,
  ]) {
    if (typeof candidate === "string") return candidate;
  }
  return "";
}

function findAttemptUserIndex(
  events: readonly SessionEvent[],
  turnIntentId: string,
  expectedUserText: string
): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.source !== "user") continue;
    if (eventTurnId(event) === turnIntentId) return index;
    const text = eventContent(event);
    if (
      expectedUserText.length > 0 &&
      (text === expectedUserText || text.endsWith(expectedUserText))
    ) {
      return index;
    }
  }
  return -1;
}

/**
 * Recover the provider-owned user row for the completed attempt.
 *
 * The optimistic row makes submission immediate, but a native transcript
 * reconcile is free to replace that projection while the provider is still
 * flushing.  Publishing only the assistant/tool suffix then leaves a
 * completed turn with no user row once the optimistic overlay is released.
 * Carry the logical turn identity onto the native user echo and merge it with
 * the suffix as one EventStore update; EventStore's transcript reconciler
 * atomically replaces the matching optimistic placeholder.
 */
function providerUserEchoForAttempt(
  events: readonly SessionEvent[],
  turnIntentId: string,
  expectedUserText: string
): SessionEvent | null {
  const userIndex = findAttemptUserIndex(
    events,
    turnIntentId,
    expectedUserText
  );
  if (userIndex < 0) return null;
  const user = events[userIndex];
  if (!user || user.source !== "user") return null;
  return {
    ...user,
    result: {
      ...(user.result ?? {}),
      turnIntentId,
    },
  };
}

/**
 * Isolate events emitted after this exact user attempt. A provider may omit
 * ORG2's private turn id, so the fallback anchors on the last matching native
 * user message. Returning null means the boundary cannot be proven and must
 * fail closed: an unproven attempt is never replayed into another episode.
 */
function sliceAttemptEvents(
  before: readonly SessionEvent[],
  after: readonly SessionEvent[],
  turnIntentId: string,
  expectedUserText: string
): SessionEvent[] | null {
  if (sameEventPrefix(before, after)) {
    const appended = after.slice(before.length);
    const anchor = findAttemptUserIndex(
      appended,
      turnIntentId,
      expectedUserText
    );
    if (anchor >= 0) return appended.slice(anchor + 1);
    // Some providers reject an oversized request before persisting its user
    // row. The unchanged prefix (plus possible lifecycle/error rows) is still
    // an exact attempt boundary, and the safety classifier below inspects all
    // appended rows before allowing a rebuild.
    if (!appended.some((event) => event.source === "user")) return appended;
    return null;
  }

  // Native compact/rollover may replace the provider file with a new thread,
  // so its historical ids are no longer an EventStore prefix. The retried
  // native user row remains the only safe boundary in that representation.
  const anchor = findAttemptUserIndex(after, turnIntentId, expectedUserText);
  return anchor >= 0 ? after.slice(anchor + 1) : null;
}

function isReplayUnsafeAttemptEvent(event: SessionEvent): boolean {
  // Match the runtime's replay-safety contract at the canonical EventStore
  // boundary. Deltas count: once any assistant/reasoning/tool/plan output was
  // visible or a tool began, replaying the user request could duplicate work.
  if (event.source !== "assistant") return false;
  return (
    Boolean(event.callId) ||
    event.displayVariant === "message" ||
    event.displayVariant === "thinking" ||
    event.displayVariant === "tool_call" ||
    event.displayVariant === "plan" ||
    event.displayVariant === "approval" ||
    event.displayVariant === "summary"
  );
}

async function isReplaySafeContextExhaustion(params: {
  sessionId: string;
  terminalStatus: TurnTerminalStatus;
  before: readonly SessionEvent[];
  turnIntentId: string;
  displayText: string;
}): Promise<boolean> {
  if (params.terminalStatus !== "failed" || !isCliSession(params.sessionId)) {
    return false;
  }
  const row = await rpc.cli
    .status({ sessionId: params.sessionId })
    .catch(() => null);
  // This durable bit is produced only by the shared runtime error classifier;
  // frontend prose matching is deliberately not a recovery authority.
  if (row?.contextExhausted !== true) return false;

  const snapshot = eventStoreProxy.getLatestSessionSnapshot(params.sessionId);
  const projectedEvents = snapshot
    ? snapshot.chatEvents
    : await eventStoreProxy.getEvents(params.sessionId).catch(() => []);
  if (projectedEvents.length > 0) {
    const projectedAttempt = sliceAttemptEvents(
      params.before,
      projectedEvents,
      params.turnIntentId,
      params.displayText
    );
    if (
      projectedAttempt === null ||
      projectedAttempt.some(isReplayUnsafeAttemptEvent)
    ) {
      return false;
    }
  }

  // EventStore can be absent in a hidden/background continuation. The target
  // provider's native transcript is therefore required as the second,
  // authoritative replay-safety proof. If it cannot be read or bounded, do
  // not create another episode.
  const nativeEvents = await loadAuthoritativeSessionEvents(params.sessionId)
    .then(({ events }) => events)
    .catch(() => null);
  if (!nativeEvents) return false;
  const nativeAttempt = sliceAttemptEvents(
    params.before,
    nativeEvents,
    params.turnIntentId,
    params.displayText
  );
  return (
    nativeAttempt !== null && !nativeAttempt.some(isReplayUnsafeAttemptEvent)
  );
}

async function finishConversationTurn(params: {
  sessionId: string;
  target: LocalConversationTarget;
  before: readonly SessionEvent[];
  turnIntentId: string;
  userEventId?: string;
  displayText: string;
  generation: number;
}): Promise<
  Pick<ContinueLocalConversationResult, "terminalStatus" | "agentTail"> & {
    replaySafeContextExhaustion: boolean;
  }
> {
  const terminalStatus = await waitForTurnTerminal(
    params.sessionId,
    params.turnIntentId
  );
  // The durable provider terminal is also a hard EventStore streaming fence.
  // CLI adapters normally clear streaming first, but their event callback is
  // intentionally fire-and-forget; a fast terminal poll can therefore finish
  // this continuation while the last StreamingSnapshot still advertises an
  // active stream. That leaves a zero-width live-assistant row in the
  // canonical transcript and makes the completed composer look half-running.
  // Await the idempotent fence here before reading/publishing the native tail.
  await eventStoreProxy
    .setStreaming(false, params.sessionId)
    .catch((error) =>
      log.warn(
        `[native-continuation] failed to close EventStore streaming for ${params.sessionId}`,
        error
      )
    );
  const replaySafeContextExhaustion = await isReplaySafeContextExhaustion({
    sessionId: params.sessionId,
    terminalStatus,
    before: params.before,
    turnIntentId: params.turnIntentId,
    displayText: params.displayText,
  });
  // The failed provider episode is not the retry authority. Its accepted user
  // row remains visible in that episode, while the canonical pre-turn log is
  // rematerialized into a fresh native episode below.
  if (replaySafeContextExhaustion) {
    markTurnTerminal(params.sessionId, terminalStatus, {
      generation: params.generation,
    });
    return {
      terminalStatus,
      agentTail: [],
      replaySafeContextExhaustion: true,
    };
  }
  // Durable provider completion is the user-facing turn boundary. Publishing
  // it must not wait for a second full parse of a very large native history:
  // that reconciliation can take tens of seconds even though Codex/Claude
  // already wrote task_complete and the final assistant row is resident in
  // EventStore. Keeping the optimistic runtime mirror at `running` during
  // that read leaves Stop/planning chrome active, prevents the completed tail
  // from collapsing, and makes the final answer look missing.
  //
  // The existing durable message queue and canonical-root lock still own
  // reconciliation, so a follow-up submitted now is parked behind this exact
  // tail read rather than racing it.
  markTurnTerminal(params.sessionId, terminalStatus, {
    generation: params.generation,
  });
  getInstrumentedStore().set(setSessionRuntimeStatusAtom, {
    sessionId: params.sessionId,
    status:
      terminalStatus === "completed"
        ? "completed"
        : terminalStatus === "cancelled"
          ? "cancelled"
          : "failed",
    source: "sync",
  });
  const settled = await loadSettledTail(
    params.sessionId,
    params.before,
    params.turnIntentId,
    params.displayText,
    terminalStatus === "cancelled"
      ? INTERRUPTED_TRANSCRIPT_SETTLE_MS
      : terminalStatus === "failed"
        ? TRANSCRIPT_SETTLE_MS
        : null
  );
  // Native CLI history is the episode's execution record, but reading it is
  // side-effect free. Publish the verified provider user echo together with
  // its assistant/tool suffix so the visible Session advances immediately.
  // EventStore transfers the optimistic row's durable identity onto the
  // native user event and removes exactly that placeholder. This also closes
  // the race where native reconcile replaces the projection before terminal:
  // publishing only the suffix used to render the answer without its prompt.
  const providerUserEcho = providerUserEchoForAttempt(
    settled.events,
    params.turnIntentId,
    params.displayText
  );
  const completedTurnEvents = providerUserEcho
    ? [providerUserEcho, ...settled.agentTail]
    : settled.agentTail;
  if (completedTurnEvents.length > 0) {
    await eventStoreProxy.mergeEvents(completedTurnEvents, params.sessionId);
  }
  // A fire-and-forget adapter callback that was already queued when the first
  // fence ran may publish one last streaming snapshot while native history is
  // being verified. Converge again after the authoritative tail merge.
  await eventStoreProxy
    .setStreaming(false, params.sessionId)
    .catch((error) =>
      log.warn(
        `[native-continuation] failed to converge EventStore terminal state for ${params.sessionId}`,
        error
      )
    );
  // Release the cross-session overlay only after the authoritative user row
  // has been merged. If the provider file is still one flush behind, keep the
  // optimistic row parked; the normal transcript reconciliation will settle
  // it when the user echo arrives instead of making the message disappear.
  if (params.userEventId && providerUserEcho) {
    clearParkedUserIntentEvent(params.userEventId);
  }
  return {
    terminalStatus,
    agentTail: settled.agentTail,
    replaySafeContextExhaustion: false,
  };
}

async function prepareConversationTurn(
  sessionId: string,
  params: Pick<
    ContinueLocalConversationParams,
    "displayText" | "imageDataUrls" | "turnIntentId"
  >,
  runtimeStatusSource: UserIntentPreparation["runtimeStatusSource"],
  pendingPolicy: UserIntentPreparation["pendingPolicy"]
): Promise<ConversationTurnPreparation> {
  return prepareUserIntent({
    sessionId,
    visibleText: params.displayText,
    imageDataUrls: params.imageDataUrls,
    turnIntentId: params.turnIntentId,
    runtimeStatusSource,
    pendingPolicy,
  });
}

async function dispatchConversationMessage(
  sessionId: string,
  params: Omit<ContinueLocalConversationParams, "timeline">,
  options: {
    allowNativeContextRecovery: boolean;
    runtimeStatusSource: UserIntentPreparation["runtimeStatusSource"];
    pendingPolicy: UserIntentPreparation["pendingPolicy"];
    preparation?: ConversationTurnPreparation;
  }
): ReturnType<typeof dispatchUserIntent> {
  return dispatchUserIntent({
    sessionId,
    visibleText: params.displayText,
    imageDataUrls: params.imageDataUrls,
    runtimeStatusSource: options.runtimeStatusSource,
    pendingPolicy: options.pendingPolicy,
    preparation: options.preparation,
    send: {
      content: params.agentContent ?? params.displayText,
      displayText: params.displayText,
      model: params.target.model,
      accountId: params.target.accountId,
      mode: "build",
      clientMessageId: `conversation-turn:${params.turnIntentId}`,
      turnIntentId: params.turnIntentId,
      turnIntentSource: "user_submit",
      directUserIntent: true,
      allowNativeContextRecovery: options.allowNativeContextRecovery,
    },
  });
}

async function createConversationExecution(
  params: Pick<ContinueLocalConversationParams, "root" | "title" | "target">
): Promise<{ sessionId: string }> {
  return SessionService.create({
    task: "",
    name: params.title,
    repoPath: params.target.workspaceRepoPath ?? undefined,
    model: params.target.model,
    accountId: params.target.accountId,
    cliAgentType: params.target.cliAgentType,
    keySource: "own_key",
    agentDefinitionId: params.target.agentDefinitionId,
    parentSessionId: conversationExecutionParentId(params.root),
    mode: "build",
  });
}

async function materializeCreatedConversation(
  sessionId: string,
  params: Pick<ContinueLocalConversationParams, "timeline">
) {
  // SessionEvent is the sole conversation authority. Even when the imported
  // source and target happen to be the same provider, a new execution episode
  // is rebuilt from the canonical role/tool event list instead of adopting a
  // provider file. This guarantees Team Chat and turns produced by every
  // other runtime participate in exactly the same target-native transcript.
  return materializeNativeConversation({
    sessionId,
    timeline: params.timeline,
  });
}

interface CreatedConversationOptions {
  loadTimeline: () => Promise<readonly SessionEvent[]>;
  pendingPolicy: UserIntentPreparation["pendingPolicy"];
  onSessionCreated?: (sessionId: string) => void | Promise<void>;
}

async function runCreatedConversationTurn(
  params: Omit<ContinueLocalConversationParams, "timeline">,
  options: CreatedConversationOptions
): Promise<ContinueLocalConversationResult> {
  const created = await createConversationExecution(params);
  let materialized:
    | Awaited<ReturnType<typeof materializeCreatedConversation>>
    | undefined;
  // Keep ownership of the eager visible preparation while launch is still
  // pending. If session_launch rejects (bad OAuth, offline CLI, etc.), close
  // that exact generation immediately instead of leaving the composer to the
  // dispatching dead-man.
  let preparation: ConversationTurnPreparation | null = null;
  try {
    preparation = await prepareConversationTurn(
      created.sessionId,
      params,
      "launch",
      options.pendingPolicy
    );
    // Native transcript conversion can take materially longer than provider
    // startup. Promote preparation out of the dispatch dead-man while keeping
    // the same shared direct-turn lifecycle used by ordinary composer sends.
    confirmUserIntentPreparation(preparation);
    await options.onSessionCreated?.(created.sessionId);
    activateUserIntentPreparation(preparation);
    const timeline = (await options.loadTimeline()).filter(
      (event) => eventTurnId(event) !== params.turnIntentId
    );
    materialized = await materializeCreatedConversation(created.sessionId, {
      timeline,
    });
    // CLI native files are outside EventStore, so seed their verified replay
    // for an immediate first render. Rust Agent materialization already
    // hydrates its own EventStore; setting the same rows here would duplicate
    // each user message under the Agent history adapter's normalized id.
    if (params.target.cliAgentType) {
      await eventStoreProxy.set(
        [...materialized.events, preparation.userEvent],
        created.sessionId
      );
    }
    await params.onSessionReady?.(
      created.sessionId,
      materialized.events.length
    );
    const dispatched = await dispatchConversationMessage(
      created.sessionId,
      params,
      {
        // A fresh episode was rebuilt from the canonical role/tool list, so
        // provider-native compact/rollover may recover a target-window limit.
        allowNativeContextRecovery: true,
        runtimeStatusSource: "launch",
        pendingPolicy: options.pendingPolicy,
        preparation,
      }
    );
    preparation = dispatched.preparation;
  } catch (error) {
    if (preparation) {
      await failUserIntentPreparation(preparation, error).catch(
        () => undefined
      );
      throw isUserIntentSendError(error)
        ? error
        : new UserIntentSendError(error, preparation.userEvent.id);
    }
    throw error;
  }

  await notifyConversationTurnAccepted(
    params.onTurnAccepted,
    created.sessionId,
    params.turnIntentId
  );

  if (!materialized) {
    throw new Error("conversation materialization completed without a receipt");
  }
  if (!preparation) {
    throw new Error("conversation dispatch completed without a preparation");
  }

  const finished = await finishConversationTurn({
    sessionId: created.sessionId,
    target: params.target,
    before: materialized.events,
    turnIntentId: params.turnIntentId,
    userEventId: preparation.userEvent.id,
    displayText: params.displayText,
    generation: preparation.generation,
  });
  return {
    sessionId: created.sessionId,
    created: true,
    terminalStatus: finished.terminalStatus,
    agentTail: finished.agentTail,
  };
}

async function continueLocalConversationAtQueueHead(
  params: ContinueLocalConversationParams,
  knownCandidates?: readonly ExecutionCandidate[]
): Promise<ContinueLocalConversationResult> {
  // Queue admission renders the new user row immediately on the canonical
  // source. Materialization must rebuild the transcript *before* that turn;
  // the provider receives it exactly once through dispatchUserIntent below.
  const effectiveParams = {
    ...params,
    timeline: params.timeline.filter(
      (event) => eventTurnId(event) !== params.turnIntentId
    ),
  };
  // Publishing the canonical user turn is independent of local execution
  // discovery. Cloud/root surfaces can render it while a native episode is
  // still being verified or materialized.
  await effectiveParams.beforeDispatch?.();
  const compatible = await findCompatibleExecution(
    effectiveParams.root,
    effectiveParams.target,
    effectiveParams.timeline,
    knownCandidates
  );
  if (compatible) {
    const preparation = await prepareConversationTurn(
      compatible.sessionId,
      effectiveParams,
      "dispatch",
      "visible"
    );
    // Synchronizing a large canonical delta is part of the accepted user
    // intent, not a pre-submit loading screen. Use the same optimistic row,
    // generation, and planning footer as an ordinary queued send before any
    // provider-native I/O begins.
    confirmUserIntentPreparation(preparation);
    let dispatched: Awaited<ReturnType<typeof dispatchConversationMessage>>;
    try {
      await effectiveParams.onSessionPreparing?.(compatible.sessionId);
      activateUserIntentPreparation(preparation);
      const beforeSynchronization = compatible.events;
      const synchronized = await synchronizeNativeConversation({
        sessionId: compatible.sessionId,
        timeline: effectiveParams.timeline,
        existingEvents: compatible.events,
      });
      compatible.events = synchronized.events;
      if (effectiveParams.target.cliAgentType) {
        await hydrateSynchronizedConversationProjection(
          compatible.sessionId,
          beforeSynchronization,
          synchronized.events
        );
      }
      // Reveal/follow the writable episode before dispatch. The ordinary
      // optimistic row and planning footer are already mounted while native
      // synchronization runs; this exact boundary only opens the live event
      // overlay at the verified pre-turn prefix.
      await effectiveParams.onSessionReady?.(
        compatible.sessionId,
        compatible.events.length
      );
      dispatched = await dispatchConversationMessage(
        compatible.sessionId,
        effectiveParams,
        {
          // Permission is not a trigger: the native transport still requires
          // an explicit context-exhausted terminal with zero assistant/tool
          // output. A compatible episode is already synchronized to the
          // canonical prefix, so provider-native compact/rollover is the
          // cheapest first recovery. The fresh canonical rebuild below
          // remains the fallback when native recovery itself fails.
          allowNativeContextRecovery: true,
          runtimeStatusSource: "dispatch",
          pendingPolicy: "visible",
          preparation,
        }
      );
    } catch (error) {
      await failUserIntentPreparation(preparation, error).catch(
        () => undefined
      );
      throw isUserIntentSendError(error)
        ? error
        : new UserIntentSendError(error, preparation.userEvent.id);
    }
    await notifyConversationTurnAccepted(
      effectiveParams.onTurnAccepted,
      compatible.sessionId,
      effectiveParams.turnIntentId
    );
    const finished = await finishConversationTurn({
      sessionId: compatible.sessionId,
      target: effectiveParams.target,
      before: compatible.events,
      turnIntentId: effectiveParams.turnIntentId,
      userEventId: dispatched.userEvent.id,
      displayText: effectiveParams.displayText,
      generation: dispatched.preparation.generation,
    });
    if (finished.replaySafeContextExhaustion) {
      return runCreatedConversationTurn(effectiveParams, {
        loadTimeline: async () => effectiveParams.timeline,
        pendingPolicy: "visible",
        onSessionCreated: effectiveParams.onSessionPreparing,
      });
    }
    return {
      sessionId: compatible.sessionId,
      created: false,
      terminalStatus: finished.terminalStatus,
      agentTail: finished.agentTail,
    };
  }

  return runCreatedConversationTurn(effectiveParams, {
    loadTimeline: async () => effectiveParams.timeline,
    pendingPolicy: "visible",
    onSessionCreated: effectiveParams.onSessionPreparing,
  });
}

function assertSupportedConversationTarget(
  target: LocalConversationTarget
): void {
  if (!supportsNativeConversationTarget(target)) {
    throw new Error(
      `target ${target.cliAgentType ?? "native"} cannot materialize a provider-native role/tool transcript`
    );
  }
}

/**
 * Reconnect a durable queue row to a provider turn accepted before this
 * renderer stopped. `session_turn_intents` is the acceptance authority; the
 * queue contributes only the concrete runner address needed to find it.
 * Returning `null` proves the backend never accepted this intent, so the
 * caller may safely run the ordinary dispatch path with the same id.
 */
export async function recoverLocalConversationTurn(
  params: RecoverLocalConversationParams
): Promise<ContinueLocalConversationResult | null> {
  assertSupportedConversationTarget(params.target);
  const durableIntent = await rpc.sessionCore.turnIntents.status({
    sessionId: params.runnerSessionId,
    turnIntentId: params.turnIntentId,
  });
  if (!durableIntent || durableIntent.status === "optimistic") return null;
  if (["stale", "coalesced", "rejected"].includes(durableIntent.status)) {
    throw new Error(
      `conversation turn was retired before provider execution (${durableIntent.status}); edit or retry it as a new intent`
    );
  }

  const candidates = await listExecutionCandidates(params.root);
  const belongsToRoot =
    candidates.some(
      (candidate) => candidate.sessionId === params.runnerSessionId
    ) ||
    (params.root.authority === "local-session" &&
      params.root.conversationId === params.runnerSessionId);
  if (
    !belongsToRoot ||
    !(await candidateMatchesTarget(params.runnerSessionId, params.target, {
      allowFailed: true,
    }))
  ) {
    throw new Error(
      "durable conversation runner no longer belongs to this root/target"
    );
  }

  const timeline = params.timeline.filter(
    (event) => eventTurnId(event) !== params.turnIntentId
  );
  const { events } = await loadAuthoritativeSessionEvents(
    params.runnerSessionId
  );
  const canonicalItems = projectNativeConversationItems(timeline);
  const executionItems = projectNativeConversationItems(events);
  if (!nativeConversationItemsArePrefix(canonicalItems, executionItems)) {
    throw new Error(
      "accepted conversation runner diverged from the canonical transcript"
    );
  }

  const generation = beginTurnDispatch(params.runnerSessionId);
  confirmTurnRunning(params.runnerSessionId);
  beginOptimisticTurn(params.runnerSessionId, "dispatch");
  try {
    await params.onSessionPreparing?.(params.runnerSessionId);
    await params.onSessionReady?.(
      params.runnerSessionId,
      params.eventStartIndex ?? timeline.length
    );
    await notifyConversationTurnAccepted(
      params.onTurnAccepted,
      params.runnerSessionId,
      params.turnIntentId
    );
    const finished = await finishConversationTurn({
      sessionId: params.runnerSessionId,
      target: params.target,
      before: timeline,
      turnIntentId: params.turnIntentId,
      displayText: params.displayText,
      generation,
    });
    return {
      sessionId: params.runnerSessionId,
      created: false,
      terminalStatus: finished.terminalStatus,
      agentTail: finished.agentTail,
    };
  } catch (error) {
    failOptimisticTurn(params.runnerSessionId, "dispatch");
    markTurnTerminal(params.runnerSessionId, "failed", { generation });
    throw error;
  }
}

export async function continueLocalConversation(
  params: ContinueLocalConversationParams
): Promise<ContinueLocalConversationResult> {
  assertSupportedConversationTarget(params.target);
  return continueLocalConversationAtQueueHead(params);
}

/**
 * Continue a canonical conversation whose authoritative history is mutable.
 * History is loaded only after the application's singleton durable queue has
 * granted this root its turn. Serialization belongs to
 * useQueueDispatch/turnLifecycle, not to this provider adapter.
 */
export async function continueLocalConversationAfterTimelineLoad(
  params: ContinueLocalConversationAfterTimelineLoadParams
): Promise<ContinueLocalConversationResult> {
  assertSupportedConversationTarget(params.target);
  // Publish the canonical user intent before native-history I/O. Cloud roots
  // can render it immediately; local/imported roots retain their durable queue
  // card until the concrete execution accepts it.
  await params.beforeDispatch?.();
  const candidates = await listExecutionCandidates(params.root);
  const matchingCandidates: ExecutionCandidate[] = [];
  for (const candidate of candidates) {
    if (await candidateMatchesTarget(candidate.sessionId, params.target)) {
      matchingCandidates.push(candidate);
    }
  }
  if (matchingCandidates.length === 0) {
    // No native episode could possibly be reused. Create the ordinary Session
    // before parsing a potentially large imported transcript so its pending
    // row, footer and follow-up queue appear through the existing UI path.
    return runCreatedConversationTurn(
      { ...params, beforeDispatch: undefined },
      {
        loadTimeline: params.loadTimeline,
        pendingPolicy: "across_session_switch",
        onSessionCreated: params.onSessionPreparing,
      }
    );
  }
  const timeline = await params.loadTimeline();
  return continueLocalConversationAtQueueHead(
    { ...params, beforeDispatch: undefined, timeline },
    matchingCandidates
  );
}
