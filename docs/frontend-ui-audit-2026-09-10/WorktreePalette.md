# WorktreePalette UI audit

Scope: main worktree label and worktree switcher name/branch presentation.

| Line                                                                              | Element               | Verdict          | Reason                                                                                                                                                          | Suggested change |
| --------------------------------------------------------------------------------- | --------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/scaffold/GlobalSpotlight/palettes/BranchPalette/index.tsx:173`               | Trailing branch label | keep with reason | Reuses SpotlightItemRow's rightLabel slot, including theme-aware secondary text, truncation and search highlighting; no new row scaffold or interactive element | None             |
| `src/scaffold/GlobalSpotlight/palettes/BranchPalette/index.tsx:153`               | Worktree name         | keep with reason | Main uses the explicitly requested unlocalized main label; linked worktrees use their directory names, with branch retained in searchable text                  | None             |
| `src/modules/WorkStation/shared/StatusBar/components/EditorStatusBarLeft.tsx:205` | Main status label     | keep with reason | Retains StatusBarLabel and existing truncation; only the requested literal text changes                                                                         | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

Checked changed UI against D1–D5: existing components and tokens are reused, no sizes/colors or keyboard interactions were added, and no new repeated scaffold was introduced. Source inspection only; desktop visual verification was not performed because computer control was not requested.
