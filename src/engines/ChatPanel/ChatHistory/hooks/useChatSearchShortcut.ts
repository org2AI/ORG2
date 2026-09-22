import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useRef,
} from "react";

import {
  type FindTarget,
  adoptFindTarget,
  closeFindTarget,
  registerFindTarget,
} from "@src/scaffold/GlobalSpotlight/FindCard/findCoordinator";

export function useChatSearchShortcut(
  containerRef: RefObject<HTMLElement | null>,
  setSearchVisible: Dispatch<SetStateAction<boolean>>,
  isSearchVisible = false
): void {
  const targetRef = useRef<FindTarget | null>(null);
  useEffect(() => {
    const target: FindTarget = {
      scope: "session",
      element: () =>
        containerRef.current?.closest<HTMLElement>("[data-chat-view-root]") ??
        containerRef.current,
      open: () => setSearchVisible(true),
      close: () => setSearchVisible(false),
    };
    targetRef.current = target;
    const unregister = registerFindTarget(target);
    return () => {
      unregister();
      targetRef.current = null;
    };
  }, [containerRef, setSearchVisible]);
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    if (isSearchVisible) adoptFindTarget(target);
    else closeFindTarget(target);
  }, [isSearchVisible]);
}
