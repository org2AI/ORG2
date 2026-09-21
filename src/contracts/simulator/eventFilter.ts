/**
 * Simulator event-filter vocabulary.
 *
 * Declared by `engines/SessionCore/core/types` and persisted by
 * `store/ui/simulatorAtom`, so the union lives here.
 */
export type SimulatorEventFilterValue =
  | "key_interactions"
  | "file_changes"
  | "terminal_events"
  | "explore"
  | "other";
