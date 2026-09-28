const REASONS: Record<string, string> = {
  native_history_runtime_unknown: "compatibility",
  native_profile_runtime_unverified: "compatibility",
  native_profile_runtime_mismatch: "compatibility",
  native_runtime_unverified: "compatibility",
  native_runtime_mismatch: "compatibility",
  native_app_changed: "changed",
  target_route_unknown: "route",
  claude_history_syncing: "checking",
  claude_history_waiting_for_exit: "waiting",
  claude_history_namespace_pending: "namespace",
  claude_history_namespace_unverified: "compatibility",
  claude_history_attention: "attention",
};

// Backend diagnostics may include private native paths. Only known public
// reason codes cross into the existing connection card's translated message.
export function historyReasonKey(reason: string | null | undefined): string {
  return `harnessConnections.marketApps.historySync.reasons.${
    (reason && REASONS[reason]) || "unavailable"
  }`;
}
