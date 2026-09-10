# Onboarding discovery refactor

Covered layers 1–7: compilation, dead code, naming, semantic ownership, defaults, domain boundaries and discoverability. Layers 8–10 (wire protocol, backend initialization and resolver symmetry) are not changed.

The account menu opens the application-owned modal through the existing tutorials event. Modal cards call existing destination owners; they do not duplicate session, repository or organization creation. Existing tour events remain compatible. The curated feature registry currently advertises repository-branch Spotlight.

Removed the sidebar checklist, progress writers/atoms, milestone navigation helpers, their exclusive tests and obsolete test-case document. Removed the old multi-variant onboarding layout. Login now owns its preserved single-card shell and artwork. Legacy settings schema/default remains readable without a destructive migration; no discovery code reads or writes retired progress.

## Dev-mode rollout and post-migration cleanup

The dev-mode-gated OnboardingHost now owns the open event and local dialog state. Disabling dev mode unmounts the listener and modal; reopening dev mode does not restore stale open state. The menu uses the same devModeEnabledAtom. Existing action-driven tours remain available independently.

Traced former guide dependencies: highlight overlay and atoms remain live through guiControlActions; animationFrameScheduler serves both tours and the overlay; organization management, runtime navigation, login artwork and shared UI primitives still have production consumers. No additional dead component was found. Removed two target-registry entries with no rendered target (workstation.dock and adeManager.composer), 13 retired sidebar-guide entries per locale, and a stale comment. Retained the two card labels and the legacy progress schema for compatibility.

Final isolated-branch checks: 40 focused tests pass, fast typecheck passes, and i18n validation passes with no new findings. The final PR records exact verification commands. Unrelated main-checkout changes are excluded.
