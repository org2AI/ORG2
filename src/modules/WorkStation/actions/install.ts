/**
 * WorkStation → scaffold action registration.
 *
 * WorkStation owns the editor / git / terminal / file / repo action surface and
 * registers it INTO the scaffold action system, rather than the scaffold
 * importing WorkStation. Imported for its side effect from the app composition
 * root (`src/App.tsx`), so the provider is installed at module-evaluation time —
 * the same point in startup at which `ActionSystemContext` used to reach into
 * this module directly, and therefore before any `ActionSystemProvider` mounts
 * or the agent ADE bridge asks for core actions.
 */
import {
  type CoreActionProvider,
  registerCoreActionProvider,
} from "@src/scaffold/ActionSystem/coreActionProvider";

import {
  cleanupServices,
  initializeServices,
  registerCoreActions,
} from "./registerCoreActions";

export const workStationCoreActionProvider: CoreActionProvider = {
  initializeServices,
  registerCoreActions,
  cleanupServices,
};

registerCoreActionProvider(workStationCoreActionProvider);
