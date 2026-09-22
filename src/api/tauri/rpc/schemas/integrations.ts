/**
 * Integrations RPC Schemas.
 *
 * Zod schemas for the two app-level config commands that manage the
 * `~/.orgii/integrations.json` store:
 *
 *   - integrations_get()              -> IntegrationsConfig
 *   - integrations_update_patch(patch) -> IntegrationsConfig
 *
 * Rust sources:
 *   - src-tauri/src/agent_core/integrations/config.rs   (IntegrationsConfig)
 *   - src-tauri/src/agent_core/integrations/patch.rs    (IntegrationsConfigPatch)
 *   - src-tauri/src/agent_core/core/definitions/commands.rs (the two RPCs)
 *
 * Same passthrough rationale as `agentDef.ts` — Rust serde is the source
 * of truth for the field shape; mirroring every sub-struct in Zod would
 * be rot-prone and add no runtime guarantee beyond what serde provides.
 *
 * # Shape reference (informal, for authoring)
 *
 * ```
 * IntegrationsConfig {
 *   channels: ChannelsConfig,       // incl. gateway.{accountId, model}
 *   databases: DatabasesConfig,
 *   nodes: NodesConfig,           // { enabled, allowedCommands }
 *   mcp: { smitheryApiKey: string },
 *   embedding: { provider: string, model?: string },
 * }
 * ```
 *
 * Per-agent exec controls (`execTimeout`) live on `AgentDefinition`, not
 * on `IntegrationsConfig`. The "restrict file/exec ops to the workspace
 * dir" toggle is `agentPolicy.workspaceOnly` — there is intentionally
 * no parallel `restrictToWorkspace` field. See
 * `agent_core/core/definitions/schema.rs` for the canonical fields.
 */
import { z } from "zod/v4";

/** Full IntegrationsConfig as returned by `integrations_get`. */
export const IntegrationsConfigSchema = z
  .record(z.string(), z.unknown())
  .describe("IntegrationsConfig (shape owned by Rust config.rs)");

/**
 * Partial patch for `IntegrationsConfig`. Every field is optional; present
 * keys replace the corresponding sub-struct on the config wholesale.
 * See Rust `IntegrationsConfigPatch` for the canonical field list.
 */
export const IntegrationsConfigPatchSchema = z
  .record(z.string(), z.unknown())
  .describe("IntegrationsConfigPatch (partial fields, wholesale replace)");

/** Input to `integrations_update_patch`. */
export const IntegrationsUpdatePatchInput = z.object({
  patch: IntegrationsConfigPatchSchema,
});

export type IntegrationsUpdatePatchInput = z.input<
  typeof IntegrationsUpdatePatchInput
>;
