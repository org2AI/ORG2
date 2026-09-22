/**
 * Project / work-item domain records — wire shape for `project_*` Tauri commands.
 *
 * These mirror the Rust types in `src-tauri/src/project_management/projects/types/`.
 * The store is global (rooted at `~/.orgii/projects/projects.db`) and slug-keyed.
 * No `repoPath` — projects are addressed by their stable slug.
 *
 * Lives in `contracts/` because `api/`, `types/`, `store/` and `modules/` all
 * name these shapes; see `src/contracts/README.md`.
 */

export * from "./agentWorkflow";
export * from "./collabSync";
export * from "./common";
export * from "./labels";
export * from "./members";
export * from "./milestones";
export * from "./projectRecords";
export * from "./routines";
export * from "./sync";
export * from "./workItems";
export * from "./workItemFeatures";
export * from "./workRuns";
