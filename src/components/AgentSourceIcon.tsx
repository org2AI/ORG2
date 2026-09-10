import React from "react";

import ModelIcon, { type IconProvider } from "@src/components/ModelIcon";

/** Agent-native config directories and the brand used to represent them. */
const AGENT_SOURCE_DIRS: ReadonlyArray<readonly [string, IconProvider]> = [
  [".codex", "codex"],
  [".claude", "claude"],
  [".cursor", "cursor"],
  [".opencode", "opencode"],
  [".gemini", "gemini"],
  [".hermes", "hermes"],
  [".openclaw", "openclaw"],
];

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Returns the agent brand implied by a native config path, if recognized. */
export function getAgentSourceProvider(path: string): IconProvider | null {
  const normalizedPath = normalizePath(path);
  return (
    AGENT_SOURCE_DIRS.find(([directory]) =>
      normalizedPath.split("/").includes(directory)
    )?.[1] ?? null
  );
}

export interface AgentSourceIconProps {
  path: string;
  size?: number;
  className?: string;
}

/** Renders a native agent brand icon, or nothing for non-agent sources. */
const AgentSourceIcon: React.FC<AgentSourceIconProps> = ({
  path,
  size = 14,
  className = "",
}) => {
  const provider = getAgentSourceProvider(path);
  if (!provider) return null;
  return <ModelIcon provider={provider} size={size} className={className} />;
};

export default AgentSourceIcon;
