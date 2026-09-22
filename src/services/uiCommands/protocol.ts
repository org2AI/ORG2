import { z } from "zod";

export const workspaceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("global") }),
  z.strictObject({
    kind: z.literal("session"),
    sessionId: z.string().min(1).max(512),
  }),
]);
export const requestSchema = z.strictObject({
  protocolVersion: z.literal(1),
  requestId: z.string().min(1).max(128),
  command: z.string(),
  target: z.strictObject({
    instanceId: z.string(),
    windowId: z.literal("main"),
    workspace: workspaceSchema,
  }),
  params: z.record(z.string(), z.unknown()),
  reveal: z.boolean(),
  timeoutMs: z.number().int().min(1).max(30000),
});
export type UiRequest = z.infer<typeof requestSchema>;
// The protocol's workspace, which is narrower than the app's
// `WorkstationWorkspaceKey`: there is no `directory` target on the wire.
export type UiWorkspace = UiRequest["target"]["workspace"];
export interface UiResponse {
  protocolVersion: 1;
  requestId: string;
  target: UiRequest["target"];
  status: "applied" | "failed" | "unknown";
  result?: unknown;
  error?: { code: string; message: string };
}
export function failure(
  request: UiRequest,
  code: string,
  message: string
): UiResponse {
  return {
    protocolVersion: 1,
    requestId: request.requestId,
    target: request.target,
    status: "failed",
    error: { code, message },
  };
}
