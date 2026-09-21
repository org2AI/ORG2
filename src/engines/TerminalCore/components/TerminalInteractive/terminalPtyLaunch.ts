import type { ShellType } from "@src/store/ui/editorSettingsAtom";

export function resolvePtyLaunchOptions({
  repoPath,
  shellType,
  customShellPath,
  shellOverride,
  forceRepoCwd,
}: {
  repoPath?: string;
  shellType: ShellType;
  customShellPath?: string;
  shellOverride?: string;
  forceRepoCwd?: boolean;
}) {
  let cwd: string | null = null;
  let shell: string | null = shellOverride || null;

  if (shell) {
    cwd = repoPath || null;
  } else if (shellType === "repo" && repoPath) {
    cwd = repoPath;
  } else if (shellType === "default") {
    cwd = null;
  } else if (shellType === "custom") {
    if (customShellPath) shell = customShellPath;
    cwd = repoPath || null;
  }

  // CLI-agent terminals must start where their session lives (worktree /
  // repo) regardless of the user's shellType cwd preference — `default`
  // would otherwise drop the agent into the home directory.
  if (forceRepoCwd && repoPath) {
    cwd = repoPath;
  }

  return { cwd, shell };
}

export function formatLastLogin(sessionKey: string) {
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return `Last login: ${timeStr} on ${sessionKey}`;
}
