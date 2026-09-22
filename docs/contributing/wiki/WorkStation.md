# WorkStation

The **WorkStation** is ORGII's main workspace — the right-side panel that opens when you select an active session. It surfaces everything the agent is doing: the code it edits, terminal commands it runs, diffs it produces, and its chat output.

## Layout

```
┌──────────────────────────────────────────────────────────┐
│  Tab bar  (Code Editor | Chat | Terminal | Diff | …)     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                   Main panel area                        │
│            (content changes per active tab)              │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  Bottom panel  (terminal, output, problems, LSP status)  │
└──────────────────────────────────────────────────────────┘
```

Each session gets its own WorkStation context. Switching sessions in the sidebar updates all panels.

## Panels

### Code Editor

A full [CodeMirror 6](https://codemirror.net/) editor with:

- Syntax highlighting for 10+ languages
- Language Server Protocol (LSP) integration — completions, diagnostics, hover, go-to-definition
- Agent-driven edits appear as streaming insertions you can accept or reject
- Side-by-side diff view when the agent proposes changes to an existing file

### Chat

The primary communication surface for the active session:

- Full message history with the agent
- Inline code blocks with syntax highlighting
- File references — click to jump to the file in the editor
- Sticky notes — pin important context to the session
- Workspace dashboard — quick overview of the session's working directory

### Terminal

An embedded terminal powered by [xterm.js](https://xtermjs.org/):

- Direct shell access within the session's working directory
- Agent-driven commands appear highlighted so you can distinguish them from manual commands
- Multiple terminal tabs per session
- Session replay — watch terminal output from a past session

### Diff Viewer

Displays file-level diffs produced by the agent:

- Unified and split diff modes
- Syntax-highlighted hunks
- Accept / reject individual hunks or full files
- GitHub PR diff integration — review PR changes without leaving ORGII

### Browser

An embedded webview for Browser Use sessions:

- The OS Agent and browser-capable CLI agents can control this view
- Navigate, click, fill forms, and capture screenshots as part of an automated task
- Session replay for browser interactions

### Canvas

A visual canvas for flow diagrams, notes, and structured output:

- Drag-and-drop nodes
- Agent can write structured data to canvas nodes
- Export to image or JSON

## Bottom panel

The bottom panel is always visible and hosts:

| Tab        | Content                                            |
| ---------- | -------------------------------------------------- |
| Terminal   | Primary integrated terminal                        |
| Output     | Agent log / raw event stream                       |
| Problems   | LSP diagnostics (errors, warnings)                 |
| LSP Status | Language server installation and connection status |

## Status bar

A slim bar at the very bottom of the WorkStation shows:

- Active session ID and type
- Agent execution mode
- Git branch and status
- LSP server state
- Key source

## Keyboard shortcuts

| Action              | Shortcut                           |
| ------------------- | ---------------------------------- |
| Focus chat input    | `Cmd/Ctrl + L`                     |
| New terminal tab    | `Cmd/Ctrl + T` (in terminal panel) |
| Toggle bottom panel | `Cmd/Ctrl + J`                     |
| Accept agent edit   | `Cmd/Ctrl + Enter` (in diff view)  |
| Reject agent edit   | `Escape` (in diff view)            |

> Shortcuts can be customized in **Settings → Keyboard**.

## Source control pane

The source control pane (accessible from the sidebar icon or `Cmd/Ctrl + Shift + G`) shows:

- Staged and unstaged changes
- File-level diff on click
- Commit, push, pull, and branch operations
- Worktree management — create and switch worktrees without leaving ORGII

## WorkStation for multiple sessions

You can open multiple sessions simultaneously. Each session's WorkStation state is independent — separate editor tabs, terminal history, and diff context. Switch between sessions using the session list on the left.
