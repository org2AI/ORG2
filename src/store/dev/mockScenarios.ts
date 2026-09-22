/**
 * Dev-mode mock scenarios.
 *
 * Session-only overrides that mask real local data at its single read
 * boundary, so first-run and empty states can be inspected without deleting
 * credentials, repos, or the session cache from disk.
 *
 * Contract every consumer must honour:
 * - Mask READS only. Writes always resolve against the real value, so turning
 *   a scenario off restores the app exactly as it was.
 * - Nothing masked may reach disk. A persistence boundary that serialises a
 *   masked list must bail out while the matching scenario is active — see
 *   `persistSessions`.
 * - Every scenario is inert unless NODE_ENV === "development". The getters
 *   re-check at read time so a production bundle can never observe one, even
 *   if a stale value survives a hot reload.
 *
 * Non-Jotai consumers (module singletons such as the shared local key store)
 * read {@link getActiveDevMockScenarios} and/or subscribe via
 * {@link subscribeDevMockScenarios}; the atom writer is the only publisher.
 */
import { atom } from "jotai";

/** Scenario ids in the order the dev settings UI renders them. */
export const DEV_MOCK_SCENARIO_IDS = [
  "newUser",
  "noKeys",
  "noWorkingDirectories",
  "noSessions",
] as const;

export type DevMockScenarioId = (typeof DEV_MOCK_SCENARIO_IDS)[number];

export type DevMockScenarioState = Record<DevMockScenarioId, boolean>;

/**
 * `newUser` is the composite first-launch state: a fresh install has no
 * credentials, no working directory, and no session history. Listing the
 * implied ids here keeps the composite honest — a new empty-state scenario
 * only has to decide whether a brand-new user would also be in it.
 */
export const NEW_USER_IMPLIED_SCENARIO_IDS = [
  "noKeys",
  "noWorkingDirectories",
  "noSessions",
] as const satisfies readonly DevMockScenarioId[];

const NO_SCENARIOS: DevMockScenarioState = Object.freeze({
  newUser: false,
  noKeys: false,
  noWorkingDirectories: false,
  noSessions: false,
});

function isDevBuild(): boolean {
  return process.env.NODE_ENV === "development";
}

/** Fold `newUser` into the individual flags. */
export function resolveDevMockScenarios(
  state: DevMockScenarioState
): DevMockScenarioState {
  if (!state.newUser) return state;
  const resolved = { ...state };
  for (const id of NEW_USER_IMPLIED_SCENARIO_IDS) resolved[id] = true;
  return resolved;
}

type DevMockScenarioListener = (scenarios: DevMockScenarioState) => void;

const listeners = new Set<DevMockScenarioListener>();
let activeScenarios: DevMockScenarioState = NO_SCENARIOS;

/**
 * Effective flags for callers that cannot read a Jotai atom (module
 * singletons, persistence helpers). Mirrors `activeDevMockScenariosAtom`.
 */
export function getActiveDevMockScenarios(): DevMockScenarioState {
  return isDevBuild() ? activeScenarios : NO_SCENARIOS;
}

/** Subscribe to effective-flag changes. Returns an unsubscribe function. */
export function subscribeDevMockScenarios(
  listener: DevMockScenarioListener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const scenarioSelectionAtom = atom<DevMockScenarioState>(NO_SCENARIOS);
scenarioSelectionAtom.debugLabel = "scenarioSelectionAtom";

/**
 * Raw switch positions — what the dev settings UI renders. Use
 * {@link activeDevMockScenariosAtom} to decide whether to mask data.
 */
export const devMockScenariosAtom = atom(
  (get) => (isDevBuild() ? get(scenarioSelectionAtom) : NO_SCENARIOS),
  (
    get,
    set,
    payload: { id: DevMockScenarioId; enabled: boolean }
  ): DevMockScenarioState => {
    if (!isDevBuild()) return NO_SCENARIOS;
    const next: DevMockScenarioState = {
      ...get(scenarioSelectionAtom),
      [payload.id]: payload.enabled,
    };
    set(scenarioSelectionAtom, next);

    activeScenarios = resolveDevMockScenarios(next);
    for (const listener of listeners) listener(activeScenarios);
    return next;
  }
);
devMockScenariosAtom.debugLabel = "devMockScenariosAtom";

/**
 * Whether the ⇧⌘D dev mock panel is open. Lives here rather than in
 * `uiAtom` so the whole dev-scenario feature is one module to find.
 */
export const devMockScenariosModalOpenAtom = atom(false);
devMockScenariosModalOpenAtom.debugLabel = "devMockScenariosModalOpenAtom";

/**
 * Turn every scenario off.
 *
 * Routes each id through `devMockScenariosAtom` rather than resetting
 * `scenarioSelectionAtom` directly, so the non-Jotai mirrors and subscribers
 * see the change. Ids already off are skipped, so a reset with nothing on is
 * a no-op rather than a burst of redundant publishes.
 */
export const resetDevMockScenariosAtom = atom(null, (get, set) => {
  for (const id of DEV_MOCK_SCENARIO_IDS) {
    if (!get(scenarioSelectionAtom)[id]) continue;
    set(devMockScenariosAtom, { id, enabled: false });
  }
});
resetDevMockScenariosAtom.debugLabel = "resetDevMockScenariosAtom";

/** Effective flags, with `newUser` folded in. Masking reads this. */
export const activeDevMockScenariosAtom = atom((get) =>
  resolveDevMockScenarios(get(devMockScenariosAtom))
);
activeDevMockScenariosAtom.debugLabel = "activeDevMockScenariosAtom";

/**
 * Test-only reset for the module-level mirror. Production code never calls
 * this — the atom writer is the only publisher.
 */
export function resetDevMockScenariosForTest(): void {
  activeScenarios = NO_SCENARIOS;
  listeners.clear();
}
