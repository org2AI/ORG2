# WorkstationHostRouting

Use one exhaustive default tab-category map for both factory construction and category-less tab routing. Export the existing mapping from the pure factory module and derive `tabTypeToTabHost` through `categoryToTabHost`. Explicit category overrides retain precedence; all current category/host assignments remain unchanged.

Architecture layers 1–7: typecheck, per-type fresh/restored parity tests, no duplicate type switch, and explicit category overrides retained. Layer 8: no serialization or IPC changes. Layer 9: newly created and restored tabs resolve through the same mapping. Layer 10: category-absent tabs derive defaults from the factory authority; category-present tabs retain overrides. Rust and runtime transport checks are outside scope.

No timers, subscriptions, caches, renderer structure, or resource ownership changes. Source revert is sufficient for rollback. Unit tests establish routing behavior, not native rendering or performance.
