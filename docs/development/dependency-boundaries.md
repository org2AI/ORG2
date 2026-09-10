# Dependency boundary gate

`pnpm check:boundaries` complements Madge's cycle check with three ownership rules:

- Production modules cannot depend on tests or the shared test harness.
- API modules cannot depend on components, scaffold or modules/view code.
- SessionCore/core cannot depend on those view layers.

Type-only dependencies count: importing a UI-owned type still reverses ownership. The scan includes all source files (including temporarily unreachable files) and does not traverse node_modules. Styles/assets are excluded; this does not replace TypeScript's unresolved-import checks or Madge's cycle check. Dynamic import paths that cannot be statically resolved remain a limitation.

## Four existing edges

The explicit baseline contains four API-to-view edges. Each remains technical debt:

- http/client/errorHandling -> components/Message: API error handling currently displays a notification. Moving notification ownership requires a behavior change and is not hidden in this tooling PR.
- tauri/agent/session -> MainApp/AgentOrgs/types and rpc/schemas/agentDef -> the same type module: shared agent types should eventually live below the view layer.
- rpc/schemas/tools -> MainApp/Integrations/Connections/Channels/types: schema code depends on a UI-owned channel type.

No production-to-test or SessionCore/core-to-view exceptions were needed. New rule/from/to edges fail CI; removing an existing edge is allowed. `node scripts/quality/dependency-boundaries/check.mjs --write-baseline` is an explicit maintenance operation: review every added edge and its reason before committing. Repeated imports of the same edge are intentionally one dependency relationship.

## Verification and operation

`pnpm test:boundaries` creates a temporary project and runs the real scanner with the production configuration. It proves all three forbidden rules fire, type-only dependencies are checked, and allowed same-layer dependencies stay valid. `pnpm check:boundaries` scanned 7,308 modules with four existing edges and zero new edges. Frozen-lockfile install succeeds. The runner parses violations itself because JSON reporter exit status alone is not a reliable gate.

Pinned dependency-cruiser 16.10.4 supports the repository's Node 20 CI runtime. It is development-only; existing lockfile package resolutions were preserved. CI has a ten-minute ceiling and cancels superseded runs. Revert the dedicated workflow/config/scripts, baseline and added dependency, then install the restored lockfile to roll back. No application state, wire format, rendering or persistence behavior changes.

Architecture coverage: ownership boundaries (layer 6), dependency graph/dead-code distinctions (2), and tooling validation (1). Other architecture layers and runtime performance matrices are unchanged.
