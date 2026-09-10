# MyStationDeadCode

Retire unused My Station contracts while preserving all active renderers, factory-owned data types, status-bar behavior, and stored settings. Source sweeps verified each removed helper or field has no live consumer. The retained replay layout type still has a consumer.

Architecture layers 1–7: typecheck and focused shell/factory tests; caller tracing; duplicate names and phase comments removed; no new defaults or ownership layers. Layer 8: no persistence or IPC format changes; the unused old title-bar storage key is left untouched. Layers 9–10: live search registration still builds actions with the repository path, and factory initialization/fallbacks are unchanged. Rust and runtime wire inspection are outside this frontend deletion scope.

No JSX structure, theme, layout, or accessibility behavior changed. Frontend UI audit is unnecessary under its type/control-flow exclusion. No new tests mirror these deletions; existing shell/factory tests verify the surviving paths. Rollback is a source revert.

Performance surface: one unused atom subscription is removed. No timer, cache, worker, network request or retained resource is added. No CPU/RSS improvement is claimed.
