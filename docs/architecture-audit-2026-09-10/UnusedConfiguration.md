# UnusedConfiguration architecture audit

Traced editor sidebar rendering to CODE_EDITOR_CONFIG.defaultTreeWidth (resetSize). Preserve its value of 300. The other editor config fields have no consumers. Repo search uses SEARCH_CONSTANTS and direct icon imports; its local ICON_CONFIG is unconsumed. The shared TabBar renders its actual strip behavior without MAX_VISIBLE_TABS or STATUS_LABELS; their re-export chain has no consumers. Delete those declarations and exports only. The separate primary-sidebar ICON_CONFIG is live and stays.

Covered layers: 1 compilation; 2 dead declarations and re-export chains; 3 remaining config names; 4 distinction between sidebar and search icon maps; 5 existing defaults preserved; 6 no new boundaries; 7 remove misleading inactive settings; 8 persistence and wire formats unchanged; 9 existing reset and initial sidebar widths preserved; 10 export/import symmetry. Rust and backend resolver behavior are outside scope.

This changes no sidebar widths, search limits, debounce intervals, exclusions, overflow behavior, or rendered styles. Verification uses typecheck, changed-file lint, and type-aware lint; no implementation-mirroring tests are added for deleting unreferenced constants. See PR Verification for exact results.
