import { type SetStateAction, useCallback, useEffect, useState } from "react";

const AGENT_ORG_OVERVIEW_INTERACTION_SELECTOR =
  "[data-agent-org-overview-panel], [data-agent-org-overview-trigger], .agent-org-overview-owned-overlay";

export function isAgentOrgOverviewInteractionTarget(
  target: EventTarget | null
): boolean {
  if (!(target instanceof Node)) return false;
  const element =
    target instanceof Element
      ? target
      : target.parentNode instanceof Element
        ? target.parentNode
        : null;
  return Boolean(element?.closest(AGENT_ORG_OVERVIEW_INTERACTION_SELECTOR));
}

interface UseAgentOrgOverviewDisclosureOptions {
  available: boolean;
  scopeKey: string | null;
}

/** Shared open/close and click-outside behavior for every Agent Org surface. */
export function useAgentOrgOverviewDisclosure({
  available,
  scopeKey,
}: UseAgentOrgOverviewDisclosureOptions) {
  const [openScopeKey, setOpenScopeKey] = useState<string | null>(null);
  const open = available && scopeKey !== null && openScopeKey === scopeKey;
  const setOpen = useCallback(
    (value: SetStateAction<boolean>) => {
      setOpenScopeKey((currentScopeKey) => {
        if (!available || scopeKey === null) return null;
        const currentOpen = currentScopeKey === scopeKey;
        const nextOpen =
          typeof value === "function" ? value(currentOpen) : value;
        return nextOpen ? scopeKey : null;
      });
    },
    [available, scopeKey]
  );

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (isAgentOrgOverviewInteractionTarget(event.target)) return;
      setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open, setOpen]);

  return { open, setOpen };
}
