/**
 * Section keys of the focused-chat workstation rail. Shared by the workspace
 * section builder and the section-order composer.
 */
export const FOCUSED_CHAT_RAIL_SECTIONS = {
  session: { key: "session", label: null },
  subagents: { key: "subagents", label: null },
  sources: { key: "sources", label: null },
  tabs: { key: "tabs", label: null },
  workspace: { key: "workspace", label: null },
} as const;
