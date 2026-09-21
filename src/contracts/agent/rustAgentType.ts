/**
 * Rust-agent runtime kind.
 *
 * Declared by the Rust backend and named across `api/`, `config/`, `util/`,
 * `store/` and every session surface, so the const map and its derived union
 * live here.
 */

export const RUST_AGENT_TYPE = {
  OS: "os",
  SDE: "sde",
  WINGMAN: "wingman",
  CUSTOM: "custom",
} as const;

export type RustAgentType =
  (typeof RUST_AGENT_TYPE)[keyof typeof RUST_AGENT_TYPE];
