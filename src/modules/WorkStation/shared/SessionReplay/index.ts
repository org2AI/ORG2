export { gateByActiveKind, type ActiveSelectionKind } from "./activeSelection";

export {
  ReplayTabBar,
  type ReplayTab,
  type KnownReplayTabKind,
} from "./ReplayTabBar";

export { SimulatorReplayChrome } from "./SimulatorReplayChrome";
export { SimulatorWorkstationTabHeader } from "./SimulatorWorkstationTabHeader";

export {
  capNewestWithActive,
  mergeNewestFirstByTimestamp,
  type TimestampedReplayTab,
} from "./replayTabHelpers";

export type { ReplayShellLayoutMode } from "./replayShellHelpers";

export { ReplayShellLayout, ReplayShellPlaceholder } from "./ReplayShellLayout";
