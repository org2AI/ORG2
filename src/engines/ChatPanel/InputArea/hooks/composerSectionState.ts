export type ComposerSecondarySection = "process" | "files";
export type ComposerActiveSection = ComposerSecondarySection | null;

interface ResolveComposerSectionSwitchOptions {
  previousSessionId?: string | null;
  nextSessionId?: string | null;
  currentActiveSection: ComposerActiveSection;
  previouslyStoredSection?: ComposerActiveSection;
}

interface ResolveComposerSectionSwitchResult {
  activeSection: ComposerActiveSection;
  storedSectionForPrevious: ComposerActiveSection | undefined;
}

export function resolveComposerSectionForSessionSwitch({
  previousSessionId,
  nextSessionId,
  currentActiveSection,
  previouslyStoredSection,
}: ResolveComposerSectionSwitchOptions): ResolveComposerSectionSwitchResult {
  if (previousSessionId === nextSessionId) {
    return {
      activeSection: currentActiveSection,
      storedSectionForPrevious: undefined,
    };
  }

  return {
    activeSection: previouslyStoredSection ?? null,
    storedSectionForPrevious: currentActiveSection,
  };
}
