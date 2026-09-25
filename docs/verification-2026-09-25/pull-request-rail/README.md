# Pull request rail component verification

These captures show the actual shared `WorkstationSections` and `WorkstationItemRow` production components with the repository's theme CSS, tokens, icons, Button, and Tooltip. They are **isolated component fixtures with synthetic PR data**, not screenshots of the running Tauri app or a live GitHub PR. Repository and branch names in the fixture are invented.

- `compact-light.png`: 256 px compact section in light theme, title truncation and separate CI indicator.
- `compact-dark.png`: the same compact section in dark theme.
- `no-pr.png`: source/environment sections remain, absent PR section is omitted.

Browser verification used the application's in-app browser. It confirmed:

1. Clicking the PR heading collapses the row; clicking again restores it and updates `aria-expanded`.
2. Clicking the summary invokes its supplied callback. Live PR detail navigation is covered at the hook's action boundary, not proven by this fixture callback.
3. The long PR title uses CSS ellipsis (164 px available width, 431 px text width) rather than expanding the 256 px panel.
4. Light and dark rendering use existing theme tokens.
5. An empty PR item projection adds no blank PR group.

The temporary fixture lived under `/tmp` and is not shipped as application code. The screenshots are unmodified browser captures. Full native-app integration, credential changes, and actual CPU/RSS measurements were not run here.

## Attachment-source correction

These original captures predate the correction that reads explicitly attached Codex PRs. They illustrate presentation only and do not demonstrate that PRs 2152 and 2153 appear in the live application. See `docs/org2-performance-guard-2026-09-25/ConversationPullRequestAttachments.md` for the production-reader evidence, new lifecycle tests, and unavailable native-UI verification boundary.
