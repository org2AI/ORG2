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
export function openEditorSpotlight(
  query = "",
  mode?: SpotlightInitialEditorMode
): void {
  if (!isStoreInitialized()) return;
  const store = getInstrumentedStore();
  store.set(
    spotlightInitialQueryAtom,
    createEditorSpotlightRequest(query, mode)
  );
  store.set(spotlightOpenAtom, true);
}

export function openWorkingDirectorySpotlight(
  mode: "switch" | "open" | "add" | "create"
): void {
  if (!isStoreInitialized()) return;
  const store = getInstrumentedStore();
  store.set(
    spotlightInitialQueryAtom,
    createWorkingDirectorySpotlightRequest(mode)
  );
  store.set(spotlightOpenAtom, true);
}

export function openCollabOrgSpotlight(
  context: SpotlightCollabOrgContext = {}
): void {
  if (!isStoreInitialized()) return;
  const store = getInstrumentedStore();
  store.set(
    spotlightInitialQueryAtom,
    createCollabOrgSpotlightRequest(context)
  );
  store.set(spotlightOpenAtom, true);
}

export function openGitHubIssuesImportSpotlight(
  context: SpotlightGitHubIssuesImportContext = {}
): void {
  if (!isStoreInitialized()) return;
  const store = getInstrumentedStore();
  store.set(
    spotlightInitialQueryAtom,
    createGitHubIssuesImportSpotlightRequest(context)
  );
  store.set(spotlightOpenAtom, true);
}

export function openBranchSpotlight(repoId?: string): void {
  if (!isStoreInitialized()) return;
  const store = getInstrumentedStore();
  store.set(spotlightInitialQueryAtom, createBranchSpotlightRequest(repoId));
  store.set(spotlightOpenAtom, true);
}

export function openWorktreeSpotlight(): void {
  if (!isStoreInitialized()) return;
  const store = getInstrumentedStore();
  store.set(spotlightInitialQueryAtom, createWorktreeSpotlightRequest());
  store.set(spotlightOpenAtom, true);
}

export function openAgentSessionSearchSpotlight(): void {
  if (!isStoreInitialized()) return;
  const store = getInstrumentedStore();
  store.set(
    spotlightInitialQueryAtom,
    createAgentSessionSearchSpotlightRequest()
  );
  store.set(spotlightOpenAtom, true);
}

export function openAllSessionsSearchSpotlight(): void {
  if (!isStoreInitialized()) return;
  const store = getInstrumentedStore();
  store.set(
    spotlightInitialQueryAtom,
    createAllSessionsSearchSpotlightRequest()
  );
  store.set(spotlightOpenAtom, true);
}

export function openAgentControlSpotlight(): void {
  if (!isStoreInitialized()) return;
  const store = getInstrumentedStore();
  store.set(spotlightInitialQueryAtom, createAgentControlSpotlightRequest());
  store.set(spotlightOpenAtom, true);
}

export function openSessionCreatorSpotlight(): void {
  if (!isStoreInitialized()) return;
  const store = getInstrumentedStore();
  store.set(spotlightInitialQueryAtom, createSessionCreatorSpotlightRequest());
  store.set(spotlightOpenAtom, true);
}

export function openSessionImportSpotlight(): void {
  if (!isStoreInitialized()) return;
  const store = getInstrumentedStore();
  store.set(spotlightInitialQueryAtom, {
    query: "",
    layer: { kind: "sessionImport" },
  });
  store.set(spotlightOpenAtom, true);
}
