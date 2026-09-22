/**
 * Simulator event filter categories.
 *
 * Single home for the filter vocabulary, the local fallback classifier and
 * the visibility predicate used by the simulator event filter dropdown.
 *
 * The authoritative classifier is `classify_simulator_event` in
 * `src-tauri/crates/types/src/session_event.rs`; every Rust snapshot carries
 * its verdict as `SimulatorEventPreview.filterCategory`. The fallback below is
 * used only by synchronous local preview paths (optimistic seeding in
 * `atoms/actions.simulatorPreview.ts`, snapshot materialization in
 * `store/snapshotMaterialization.simulatorPreview.ts`, and the derived
 * `simulatorEvents` atoms) until that snapshot arrives and overwrites it.
 *
 * The fallback is deliberately NOT in lockstep with the Rust classifier. Known
 * divergences, kept as-is so the local approximation stays behavior-preserving
 * (`core/__tests__/simulatorEventFilters.rustParity.test.ts` pins them):
 *
 * - Rust classifies by `ui_canonical`, falling back to `function_name` when
 *   `ui_canonical` is empty. TS reads `uiCanonical` only.
 * - Rust routes `ask_user_questions`, `ask_user_permissions`,
 *   `suggest_mode_switch`, `create_plan` and `manage_secrets` to
 *   `key_interactions`; TS only routes `source === "user"` there.
 * - Rust routes `await_output` and `inspect_terminals` to `terminal_events`;
 *   TS only routes `run_shell` (plus any event carrying a `command`).
 * - Rust's explore set is `read_file`, `list_dir`, `list_directory`,
 *   `code_search`, `codebase_search`, `web_search`, `web_fetch`,
 *   `glob_file_search`, `find_files`, `query_lsp`, `tool_search`. TS's is
 *   `read_file`, `list_dir`, `code_search`, `glob`, `find_files`, `search`.
 *   `glob` / `search` are not Rust `ui_canonical` names, and the Rust-only
 *   names fall through to TS's `filePath` / `other` branches.
 * - Rust treats `Some("")` for `command` / `file_path` as present; TS treats
 *   an empty string as absent.
 */
import type {
  SessionEvent,
  SimulatorEventFilterValue,
  SimulatorEventPreview,
} from "./types";

export const SIMULATOR_EVENT_FILTER_VALUES = [
  "key_interactions",
  "file_changes",
  "terminal_events",
  "explore",
  "other",
] as const satisfies readonly SimulatorEventFilterValue[];

export type { SimulatorEventFilterValue };

/**
 * Local fallback category for a simulator preview built on the frontend.
 * See the module docblock for how this differs from the Rust classifier.
 */
export function getFallbackSimulatorEventFilterCategory(
  event: SessionEvent
): SimulatorEventFilterValue {
  if (event.source === "user") return "key_interactions";
  if (
    event.uiCanonical === "edit_file" ||
    event.uiCanonical === "delete_file"
  ) {
    return "file_changes";
  }
  if (event.command || event.uiCanonical === "run_shell") {
    return "terminal_events";
  }
  if (
    event.uiCanonical === "read_file" ||
    event.uiCanonical === "list_dir" ||
    event.uiCanonical === "code_search" ||
    event.uiCanonical === "glob" ||
    event.uiCanonical === "find_files" ||
    event.uiCanonical === "search"
  ) {
    return "explore";
  }
  if (event.filePath) return "file_changes";
  return "other";
}

export function isSimulatorEventVisibleForFilters(
  preview: SimulatorEventPreview,
  selectedFilters: readonly SimulatorEventFilterValue[]
): boolean {
  if (selectedFilters.length === 0) return true;
  return selectedFilters.includes(preview.filterCategory);
}
