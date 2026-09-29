# Categorized conversation Sources

The focused chat rail opens a stable session-scoped Sources tab. Images, files, links and tool activity appear in fixed category order, newest occurrence first inside each category. Empty categories disappear; each category independently pages 30 rows. Rail previews prioritize real resources before tool groups. View all stays reachable while folded; the duplicate Sources row is omitted from Opened Tabs. Sources hides the editor tree/shared toolbar without changing stored sidebar preferences.

One read-only source projection serves native storage, Codex transcripts and Claude transcripts. It includes visible user attachments, assistant references and explicit successful structured resources, plus completed tool activity and error summaries. It never scans arbitrary shell/JavaScript/log text for resource paths. Codex FileChange receipts remain activity rather than fabricated artifacts. Repeated identical tool actions aggregate by exact tool/action/query/url/status/error, preserving call identities and total counts. Explicit artifacts/citations still appear.

Source reference/navigation identity remains canonical; display paths unwrap transcript image envelopes without leaking session IDs. Shared/imported files use sender org/session/endpoint scope; the new develop shared-file tab opener is verified at its navigation boundary rather than the previous overlay seam.

Compatibility: new optional role/toolName/toolActivity fields extend the existing source-message wire response, with defaults preserving old user-only producers. A new session-sources tab kind participates in persistence/classification. No database migration or write to message history. Older binaries may discard unknown saved tabs; reopening View all recreates this ephemeral view. Rollback is code revert; historical source projections update on reread.

Architecture reviewed: module ownership, duplicate presentation, types, provider-neutral projection, fallback behavior, wire compatibility, reader entrypoints and scope-aware navigation. No auth or sync protocol changed. Root cause of repeated labels was many distinct calls projected identically, not duplicate persisted messages; no destructive history cleanup.

## Verification

Final checks and counts are recorded in the PR description. Frontend suite includes feature, reader hook/extraction, rail, actual renderer, image navigation, sidebar/header tab transitions and tab persistence classification. Rust suites exercise shared projector, Codex/Claude actual transcript readers and native SQL source extraction. Scoped lint and typecheck run from the isolated latest-develop worktree.

Screenshots are actual production components rendered with fictional fixtures and mocked navigation/image resolution. Light and dark narrow layouts plus empty/loading/error states were inspected. These do not prove native application full-stack behavior. No complete application Rust build, Windows/Linux native verification, remote dual-instance or huge transcript benchmark was run on this isolated PR branch.
