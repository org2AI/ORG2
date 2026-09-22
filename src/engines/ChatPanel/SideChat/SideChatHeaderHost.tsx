import { atom, useSetAtom } from "jotai";
import { useLayoutEffect, useState } from "react";

import { DETAIL_RAIL_BREAKPOINT } from "@src/hooks/ui/layout/useDetailRailLayout";

// Entries exist only for mounted, visible, narrow detail headers in this store.
const headerHostsAtom = atom<readonly HTMLElement[]>([]);
export const sideChatHeaderHostAtom = atom(
  (get) => get(headerHostsAtom).at(-1) ?? null
);

/** Portal destination in the issue/PR tab bar; measures the owning pane. */
export function SideChatHeaderHost() {
  const [host, setHost] = useState<HTMLSpanElement | null>(null);
  const setHosts = useSetAtom(headerHostsAtom);

  useLayoutEffect(() => {
    if (!host) return;
    const pane =
      host.closest<HTMLElement>("[data-detail-pane-layout]") ??
      host.closest<HTMLElement>(
        '[data-testid="chat-panel-published-header"]'
      ) ??
      host.closest<HTMLElement>("[data-published-header-slots]") ??
      host.closest<HTMLElement>('[role="tablist"]');
    if (!pane) return;
    const update = () => {
      const width = pane.clientWidth;
      const eligible = width > 0 && width < DETAIL_RAIL_BREAKPOINT;
      setHosts((current) => {
        const registered = current.includes(host);
        if (registered === eligible) return current;
        return eligible
          ? [...current, host]
          : current.filter((entry) => entry !== host);
      });
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(pane);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      setHosts((current) =>
        current.includes(host)
          ? current.filter((entry) => entry !== host)
          : current
      );
    };
  }, [host, setHosts]);

  return (
    <span
      ref={setHost}
      className="inline-flex shrink-0 items-center"
      data-side-chat-header-host
    />
  );
}
