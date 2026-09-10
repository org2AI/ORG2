# TimelineTypeRetirement

The timeline action already creates `git-diff` tabs with `isTimeline: true`. Remove the dormant `timeline-diff` union variant, dispatcher entry, and its sole placeholder component. Keep the stable `timeline-diff:` ID prefix and real timeline renderer behavior.

The storage ingestion boundary accepts an old serialized literal and normalizes it to `git-diff` with `isTimeline: true` before validation. IDs, references and commit data are preserved; malformed payloads still fail validation. No local database or user storage was inspected or rewritten by this change. Subsequent normal persistence writes use the supported type. Both old and new app versions accept `git-diff`, so reverting the source remains compatible.

Architecture layers 1–7: typecheck, factory/storage/ownership suites, full literal sweep, and exhaustive type ownership. Layer 8: stored record compatibility covered at the sanitizer; no IPC format changes. Layer 9: factory creation and storage restoration tested. Layer 10: existing field values are retained while the timeline marker is canonicalized. Rust and runtime network payloads are outside scope.

Deleted JSX was only reachable through the dormant type; native screenshots add no evidence for the storage/factory boundary. Native timeline content loading was not exercised. No background ownership changes or performance improvement are claimed.

CI follow-up: removing the dormant union member changed the type-aware lint diagnostic for the existing partial tab-title switch. Replace that switch with a sparse map of localized singleton titles and an explicit main-terminal case, retaining stored titles for other tabs. The baseline is unchanged. Regression coverage verifies file/custom-terminal fallbacks and main-terminal localization; the existing timeline markup assertion still passes.
