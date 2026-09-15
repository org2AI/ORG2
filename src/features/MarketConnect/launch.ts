import { stat } from "@tauri-apps/plugin-fs";
import { z } from "zod/v4";

import { loadAvailableAgents } from "@src/api/services/availableAgents";
import { defineProcedure, typedInvoke } from "@src/api/tauri/rpc/invoke";

import { type Connection, loadConfig } from "./rpc";

const openClient = defineProcedure("market_connection_open_client")
  .input(
    z.object({
      agent: z.string(),
      selection: z.string(),
      model: z.string(),
      folder: z.string(),
    })
  )
  .output(z.null())
  .build();

export class MarketLaunchError extends Error {
  constructor(public readonly reason: "clientMissing" | "launchFailed") {
    super(reason);
  }
}

/** Open the independent client; no ORG2 terminal or background proxy owns it. */
export async function prepareLaunch(
  connection: Connection,
  selection: string,
  model: string,
  folder: string,
  active: () => boolean
) {
  const platform =
    connection.target === "claude-code"
      ? "claude_code"
      : connection.target === "codex"
        ? "codex"
        : connection.target === "claude-app"
          ? "claude_desktop"
          : null;
  if (!platform || !selection.startsWith("market:") || !model || !folder)
    throw new MarketLaunchError("launchFailed");
  const checkSelection = async () => {
    const config = await loadConfig(connection);
    if (
      !active() ||
      config.conflict ||
      (config.mode !== "orgii_managed" &&
        !(platform === "claude_desktop" && config.mode === "direct")) ||
      config.selectedKeyId !== selection ||
      config.selectedModel !== model
    )
      throw new MarketLaunchError("launchFailed");
  };
  const [info, agents] = await Promise.all([
    stat(folder),
    platform === "claude_desktop" ? Promise.resolve([]) : loadAvailableAgents(),
  ]);
  if (!info.isDirectory) throw new MarketLaunchError("launchFailed");
  const agent = agents.find((a) => a.name === platform && a.installed);
  if (platform !== "claude_desktop" && !agent?.command.trim())
    throw new MarketLaunchError("clientMissing");
  await checkSelection();
  await typedInvoke(openClient, { agent: platform, selection, model, folder });
}
