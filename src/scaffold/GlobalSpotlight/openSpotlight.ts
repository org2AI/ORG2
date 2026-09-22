/**
 * Imperative helpers for opening GlobalSpotlight from outside React trees
 * (Zod actions, DOM event handlers, services, etc.).
 *
 * These go through the same jotai atoms as the React-side openers, so the
 * unified spotlight state stays single-source-of-truth. Callers wanting a
 * second-layer sub-flow should use the typed open helpers below — they open
 * the main Spotlight and prime the matching URL-like route state.
 */
import {
  type SpotlightCollabOrgContext,
  type SpotlightGitHubIssuesImportContext,
  type SpotlightInitialEditorMode,
  type SpotlightInitialQuery,
  spotlightInitialQueryAtom,
  spotlightOpenAtom,
} from "@src/store/ui/uiAtom";
import {
  getInstrumentedStore,
  isStoreInitialized,
} from "@src/util/core/state/instrumentedStore";

export function createEditorSpotlightRequest(
  query = "",
  mode?: SpotlightInitialEditorMode
): SpotlightInitialQuery {
  return {
    query,
    layer: { kind: "editor", mode },
  };
}

function createWorkingDirectorySpotlightRequest(
  mode: "switch" | "open" | "add" | "create"
): SpotlightInitialQuery {
  return {
    query: "",
    layer: { kind: "workspace", mode },
  };
}

export function createCollabOrgSpotlightRequest(
  context: SpotlightCollabOrgContext = {}
): SpotlightInitialQuery {
  return {
    query: "",
    layer: { kind: "collabOrg", context },
  };
}

export function createGitHubIssuesImportSpotlightRequest(
  context: SpotlightGitHubIssuesImportContext = {}
): SpotlightInitialQuery {
  return {
    query: "",
    layer: { kind: "githubIssuesImport", context },
  };
}

export function createBranchSpotlightRequest(
  repoId?: string
): SpotlightInitialQuery {
  return {
    query: "",
    layer: { kind: "branch", ...(repoId ? { repoId } : {}) },
  };
}

function createWorktreeSpotlightRequest(): SpotlightInitialQuery {
  return { query: "", layer: { kind: "worktree" } };
}

export function createAgentSessionSearchSpotlightRequest(): SpotlightInitialQuery {
  return { query: "", layer: { kind: "agentSessionSearch" } };
}

function createAllSessionsSearchSpotlightRequest(): SpotlightInitialQuery {
  return { query: "", layer: { kind: "allSessionsSearch" } };
}

function createAgentControlSpotlightRequest(): SpotlightInitialQuery {
  return { query: "", layer: { kind: "agentControl" } };
}

function createSessionCreatorSpotlightRequest(): SpotlightInitialQuery {
  return { query: "", layer: { kind: "sessionCreator" } };
}

export function closeGlobalSpotlight(): void {
  if (!isStoreInitialized()) return;
  getInstrumentedStore().set(spotlightOpenAtom, false);
}

/**
 * Open the main GlobalSpotlight in an editor-scoped sub-flow.
 * Supported default modes let command search open with an empty input while
 * preserving the explicit prefixes used by editor-local shortcuts.
 */
function openGlobalSpotlight(request: SpotlightInitialQuery): void {
  if (!isStoreInitialized()) return;
  const store = getInstrumentedStore();
  store.set(spotlightInitialQueryAtom, request);
  store.set(spotlightOpenAtom, true);
}

export function openEditorSpotlight(
  query = "",
  mode?: SpotlightInitialEditorMode
): void {
  openGlobalSpotlight(createEditorSpotlightRequest(query, mode));
}

export function openWorkingDirectorySpotlight(
  mode: "switch" | "open" | "add" | "create"
): void {
  openGlobalSpotlight(createWorkingDirectorySpotlightRequest(mode));
}

export function openCollabOrgSpotlight(
  context: SpotlightCollabOrgContext = {}
): void {
  openGlobalSpotlight(createCollabOrgSpotlightRequest(context));
}

export function openGitHubIssuesImportSpotlight(
  context: SpotlightGitHubIssuesImportContext = {}
): void {
  openGlobalSpotlight(createGitHubIssuesImportSpotlightRequest(context));
}

export function openBranchSpotlight(repoId?: string): void {
  openGlobalSpotlight(createBranchSpotlightRequest(repoId));
}
export function openWorktreeSpotlight(): void {
  openGlobalSpotlight(createWorktreeSpotlightRequest());
}
export function openAgentSessionSearchSpotlight(): void {
  openGlobalSpotlight(createAgentSessionSearchSpotlightRequest());
}
export function openAllSessionsSearchSpotlight(): void {
  openGlobalSpotlight(createAllSessionsSearchSpotlightRequest());
}
export function openAgentControlSpotlight(): void {
  openGlobalSpotlight(createAgentControlSpotlightRequest());
}
export function openSessionCreatorSpotlight(): void {
  openGlobalSpotlight(createSessionCreatorSpotlightRequest());
}
export function openSessionImportSpotlight(): void {
  openGlobalSpotlight({ query: "", layer: { kind: "sessionImport" } });
}
