import type { FocusedChatRailItem, FocusedChatRailSubagent } from "./types";

/** Map a subagent lifecycle status onto the rail's CI-shaped status chip. */
export function resolveSubagentRowStatus(
  t: (key: string) => string,
  status: FocusedChatRailSubagent["status"]
): NonNullable<FocusedChatRailItem["status"]> {
  const label =
    status === "completed"
      ? t("common:git.rail.subagentCompleted")
      : status === "failed"
        ? t("common:git.rail.subagentFailed")
        : status === "running"
          ? t("common:git.rail.subagentRunning")
          : t("common:git.rail.subagentPending");
  return {
    label,
    state:
      status === "completed"
        ? "success"
        : status === "failed"
          ? "failure"
          : status === "running"
            ? "pending"
            : "checking",
    title: label,
    // The glyph alone marks the row; the localized label stays as the
    // tooltip so five finished rows don't repeat the same word five times.
    iconOnly: true,
  };
}
