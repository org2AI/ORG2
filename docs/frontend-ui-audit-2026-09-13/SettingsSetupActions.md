# Settings setup search actions

| Line                                                                             | Element           | Verdict          | Reason                                                                                                                | Suggested change |
| -------------------------------------------------------------------------------- | ----------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------- |
| src/scaffold/NavigationSidebar/variants/SettingsSidebarSearch.tsx:151            | Setup results     | keep with reason | Actions reuse the existing sidebar row tokens, indentation and option keyboard behavior; no new row styling           | None             |
| src/modules/MainApp/Integrations/KeyVault/AccountCategoryView.tsx:19             | Key wizard        | keep with reason | Existing wizard receives provider selection; a provider key resets stale form state when switching setup destinations | None             |
| src/modules/MainApp/Integrations/Connections/Channels/ChannelPreviewPanel.tsx:80 | Connection wizard | keep with reason | Existing setup form and auth choices are reused; provider changes remount its local draft                             | None             |

0 fix / 3 keep with reason / 0 abstract. No cross-file visual sweep identified.

Verification: 44 focused Vitest tests, fast typecheck and scoped ESLint passed. Visual desktop verification was not run: computer control is not authorized.
