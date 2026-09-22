/**
 * Project store types — wire shape for `project_*` Tauri commands.
 *
 * The declarations moved down to `@src/contracts/project` so that `src/types/`
 * and `src/store/` can name them without importing `api/`. This module stays as
 * the api-tier facade; keep importing it from `api/` call sites.
 */

export * from "@src/contracts/project";
