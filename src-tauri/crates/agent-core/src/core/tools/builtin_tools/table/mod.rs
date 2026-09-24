//! `BUILTIN_TOOLS` — joined view over per-category sub-tables.
//!
//! Each category lives in its own file so per-category edits stay focused
//! and no individual file exceeds ~450 lines:
//!
//! - `coding` — file/edit/search/lsp/workspace/worktree/plan/setup/todo
//! - `web` — web search/fetch + external/internal browsers
//! - `desktop` — macOS automation primitives (15 entries)
//! - `agent` — the unified `agent` tool (subagent dispatch)
//! - `data` — manage_nodes + database explore/run
//! - `agent_hidden` — hidden plumbing (ask_user, manage_session, send_*,
//!   tool_search)
//! - `events` — UI-only event entries (thinking, agent_message,
//!   user_message, subagent, mcp_tool, tool_call, suggest_mode_switch,
//!   ask_user_permissions)
//!
//! Macros + alias module are shared to keep entries terse.

mod aliases;
mod macros;

mod agent;
mod agent_hidden;
mod agent_org_tasks;
mod coding;
mod data;
mod desktop;
mod events;
mod web;

use super::types::ToolEntry;
use app_ui::agent_tools::Kind;
use std::sync::LazyLock;

/// Single source of truth for all built-in tool metadata.
///
/// Materialised once at first access by cloning each per-category sub-table
/// into a single `Vec`, then leaked into a `&'static [ToolEntry]` so the
/// public type matches the original monolithic static and every existing
/// `BUILTIN_TOOLS.iter()` call site keeps yielding `&'static ToolEntry`.
///
/// `ToolEntry` is plain data over `&'static` references and `Copy` enums, so
/// the per-process clone+leak is one ~50-element allocation that lives for
/// the lifetime of the process.
pub static BUILTIN_TOOLS: LazyLock<&'static [ToolEntry]> = LazyLock::new(|| {
    let mut all: Vec<ToolEntry> = Vec::new();
    for slice in [
        coding::TOOLS,
        web::TOOLS,
        desktop::TOOLS,
        agent::TOOLS,
        data::TOOLS,
        agent_hidden::TOOLS,
        agent_org_tasks::TOOLS,
        events::TOOLS,
    ] {
        all.extend_from_slice(slice);
    }
    all.extend(app_ui::agent_tools::ALL.iter().map(|kind| {
        // The eight UI tools differ by consequence, so the transcript has to
        // as well: presenting a surface, reading a MyStation terminal's
        // output, and typing into one each get their own labels and icon.
        // The five read-only inspection tools keep the shared `orgiiGui*`
        // labels. The match is exhaustive on purpose — a new `Kind` must
        // pick a group instead of silently inheriting the generic labels.
        let (icon_id, label_running, label_done, label_failed) = match kind {
            Kind::Open => (
                "panel-top",
                "tools.orgiiGuiOpenRunning",
                "tools.orgiiGuiOpenDone",
                "tools.orgiiGuiOpenFailed",
            ),
            // `terminal-square` matches `inspect_terminals`, the other
            // read-a-terminal tool.
            Kind::ReadTerminal => (
                "terminal-square",
                "tools.orgiiGuiTerminalReadRunning",
                "tools.orgiiGuiTerminalReadDone",
                "tools.orgiiGuiTerminalReadFailed",
            ),
            // `terminal` matches `run_shell`: the only other tool that can
            // put a command into a shell.
            Kind::WriteTerminal => (
                "terminal",
                "tools.orgiiGuiTerminalWriteRunning",
                "tools.orgiiGuiTerminalWriteDone",
                "tools.orgiiGuiTerminalWriteFailed",
            ),
            Kind::Context | Kind::Tabs | Kind::Terminals | Kind::Docs | Kind::Result => (
                "eye",
                "tools.orgiiGuiRunning",
                "tools.orgiiGuiDone",
                "tools.orgiiGuiFailed",
            ),
        };
        ToolEntry {
            name: kind.name(),
            description: kind.description(),
            description_detail: kind.description(),
            category: aliases::tool_categories::WEB,
            icon_id,
            simulator_app: aliases::AppCode,
            app_subtool: aliases::OtherTool,
            chat_block: aliases::CbFallback,
            required_capability: aliases::CapManagement,
            label_running,
            label_done,
            label_failed,
            ..super::types::DEFAULT_TOOL_ENTRY
        }
    }));
    Vec::leak(all)
});
