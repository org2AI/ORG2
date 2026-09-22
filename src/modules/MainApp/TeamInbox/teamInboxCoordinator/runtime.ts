import type { Store } from "jotai/vanilla/store";

import type { MemberEntry } from "@src/api/http/project";
import type {
  TeamInboxMentionsPage,
  TeamInboxReadMutation,
} from "@src/features/Org2Cloud/teamInboxMentionsClient";

import type {
  TeamInboxCursor,
  TeamInboxFilter,
  TeamInboxIssue,
  TeamInboxItem,
} from "../domain";

export const MAX_CACHED_TEAM_INBOX_ITEMS = 500;
export const MAX_PENDING_TEAM_INBOX_MUTATIONS = 100;

export interface LocalPageResult {
  page: {
    items: TeamInboxItem[];
    nextCursor: TeamInboxCursor | null;
    unreadCounts?: {
      all: number;
      mentions: number;
      assigned: number;
    };
  };
  unreadCount: number;
}

export interface LocalUnreadCounts {
  all: number;
  mentions: number;
  assigned: number;
}

export interface TeamInboxCoordinatorDependencies {
  listLocalPage(
    viewerMemberIds: readonly string[],
    filter: TeamInboxFilter,
    cursor?: TeamInboxCursor | null
  ): Promise<LocalPageResult>;
  listInitialMentions(
    accessToken: string,
    orgId: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<TeamInboxMentionsPage>;
  listMentions(
    accessToken: string,
    orgId: string,
    cursor: string | null,
    limit: number,
    signal?: AbortSignal
  ): Promise<TeamInboxMentionsPage>;
  markLocalRead(
    viewerMemberIds: readonly string[],
    itemId: string
  ): Promise<boolean>;
  markLocalUnread(
    viewerMemberIds: readonly string[],
    itemId: string
  ): Promise<boolean>;
  markAllLocalRead(
    viewerMemberIds: readonly string[],
    filter: TeamInboxFilter
  ): Promise<number>;
  setMentionRead(
    accessToken: string,
    orgId: string,
    commentId: string,
    read: boolean,
    signal?: AbortSignal
  ): Promise<TeamInboxReadMutation>;
  markAllMentionsRead(
    accessToken: string,
    orgId: string,
    signal?: AbortSignal
  ): Promise<TeamInboxReadMutation>;
  now(): string;
}

export interface TeamInboxCoordinatorScope {
  key: string;
  viewerMemberIds: readonly string[];
  accessToken: string | null;
  activeCloudOrgId: string | null;
  members: readonly MemberEntry[];
  /** Degraded prerequisite reads (for example, a subset of member files). */
  prerequisiteIssue?: TeamInboxIssue | null;
}

export interface CoordinatorRuntime {
  scopeKey: string;
  generation: number;
  scopeController: AbortController;
  localCursor: TeamInboxCursor | null;
  cloudCursor: string | null;
  refreshPromise: Promise<void> | null;
  activeRefreshVersion: string | null;
  desiredRefreshVersion: string | null;
  queuedRefresh: { scope: TeamInboxCoordinatorScope; version: string } | null;
  loadMorePromise: Promise<void> | null;
  mutationTail: Promise<void>;
  pendingMutations: number;
  mutationEpoch: number;
  mutationEpochByItem: Map<string, number>;
  invalidationQueued: boolean;
  localUnreadCounts: LocalUnreadCounts;
  cloudUnreadCount: number;
}

/** Per-store runtime lookup shared by the coordinator and its collaborators. */
export type CoordinatorRuntimeByStore = WeakMap<Store, CoordinatorRuntime>;

/** What a coordinator operation needs beyond the store and scope it acts on. */
export interface TeamInboxCoordinatorContext {
  dependencies: TeamInboxCoordinatorDependencies;
  runtimeByStore: CoordinatorRuntimeByStore;
}

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

export function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error })
  );
}

export function createRuntime(scopeKey: string): CoordinatorRuntime {
  return {
    scopeKey,
    generation: 0,
    scopeController: new AbortController(),
    localCursor: null,
    cloudCursor: null,
    refreshPromise: null,
    activeRefreshVersion: null,
    desiredRefreshVersion: null,
    queuedRefresh: null,
    loadMorePromise: null,
    mutationTail: Promise.resolve(),
    pendingMutations: 0,
    mutationEpoch: 0,
    mutationEpochByItem: new Map(),
    invalidationQueued: false,
    localUnreadCounts: { all: 0, mentions: 0, assigned: 0 },
    cloudUnreadCount: 0,
  };
}

export function localUnreadCounts(result: LocalPageResult): LocalUnreadCounts {
  return (
    result.page.unreadCounts ?? {
      all: result.unreadCount,
      mentions: 0,
      assigned: result.unreadCount,
    }
  );
}
