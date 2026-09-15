import { z } from "zod/v4";

import { defineProcedure, typedInvoke } from "@src/api/tauri/rpc/invoke";
import { CliConfigManagedStatusSchema } from "@src/api/tauri/rpc/schemas/agentOrgs";

export const connectionSchema = z.object({
  identity_user_id: z.string().uuid(),
  workspace_id: z.string().regex(/^ws_[A-Za-z0-9_-]{1,120}$/),
  target: z.enum(["claude-code", "claude-app", "codex", "org2"]),
});
export type Connection = z.infer<typeof connectionSchema>;
const moduleStatus = defineProcedure("market_connection_status")
  .output(
    z.object({
      enabled: z.boolean(),
      buyer_persistent_credentials: z.boolean(),
      seller_temporary_authorization: z.boolean(),
      connections: z.array(
        connectionSchema.extend({
          phase: z.enum(["authorization_saved", "reauthorization_required"]),
        })
      ),
    })
  )
  .build();
export const loadConnections = () => typedInvoke(moduleStatus);
const input = z.object({
  identityUserId: z.string().uuid(),
  workspaceId: z.string(),
  target: connectionSchema.shape.target,
});
export const entrySchema = z.object({
  entitlement_id: z.string(),
  service_id: z.string(),
  service_name: z.string(),
  models: z.array(z.string()),
  models_by_agent: z.object({
    claude: z.array(z.string()),
    codex: z.array(z.string()),
  }),
  status: z.string(),
  expires_at: z.number().nullable(),
});
export type Entry = z.infer<typeof entrySchema>;
const options = defineProcedure("market_connection_options")
  .input(input)
  .output(z.array(entrySchema))
  .build();
const apply = defineProcedure("market_connection_apply")
  .input(
    input.extend({
      entitlementId: z.string(),
      model: z.string(),
      expectedHashes: z.record(z.string(), z.string().nullable()),
    })
  )
  .output(CliConfigManagedStatusSchema)
  .build();
const disconnect = defineProcedure("market_connection_disconnect")
  .input(input)
  .build();
const status = defineProcedure("cli_config_get_status")
  .input(z.object({ agentName: z.string() }))
  .output(CliConfigManagedStatusSchema)
  .build();
const args = (c: Connection) => ({
  identityUserId: c.identity_user_id,
  workspaceId: c.workspace_id,
  target: c.target,
});
export const agentFor = (c: Connection) =>
  c.target === "codex"
    ? "codex"
    : c.target === "claude-code"
      ? "claude_code"
      : c.target === "claude-app"
        ? "claude_desktop"
        : null;
export const loadEntries = (c: Connection) => typedInvoke(options, args(c));
export const loadConfig = (c: Connection) => {
  const agentName = agentFor(c);
  if (!agentName) throw Error("ORG2 launch is not configured");
  return typedInvoke(status, { agentName });
};
export const applyConfig = (
  c: Connection,
  entitlementId: string,
  model: string,
  expectedHashes: Record<string, string | null>
) => typedInvoke(apply, { ...args(c), entitlementId, model, expectedHashes });
export const disconnectConfig = (c: Connection) =>
  typedInvoke(disconnect, args(c));

const prepareSession = defineProcedure("market_connection_prepare_session")
  .input(
    input.extend({
      entitlementId: z.string(),
      agent: z.enum(["claude_code", "codex"]),
      model: z.string().min(1).max(256),
    })
  )
  .output(z.string().startsWith("market:"))
  .build();
export const prepareSessionSource = (
  c: Connection,
  entitlementId: string,
  agent: "claude_code" | "codex",
  model: string
) => typedInvoke(prepareSession, { ...args(c), entitlementId, agent, model });
