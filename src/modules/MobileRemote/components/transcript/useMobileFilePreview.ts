import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { MobileFileTarget } from "./mobileFileTool";

export type MobileDesktopFileState =
  | { phase: "idle" }
  | { phase: "opening" }
  | { phase: "requested" }
  | { phase: "failed"; message: string };

export interface MobileDesktopFileAction {
  state: MobileDesktopFileState;
  open: () => Promise<void>;
}

/** One mounted tool preview owns selection and explicit Desktop requests. */
export function useMobileFilePreview(
  targets: MobileFileTarget[],
  onOpenFile?: (target: MobileFileTarget) => Promise<void>
) {
  const [selectedIndex, setSelectedIndex] = useState(
    () => targets[0]?.targetIndex
  );
  const selectedTarget =
    targets.find((target) => target.targetIndex === selectedIndex) ??
    targets[0];
  const [state, setState] = useState<MobileDesktopFileState>({ phase: "idle" });
  // The token is also a synchronous single-flight gate, before React rerenders.
  const request = useRef<object | null>(null);
  const available = Boolean(onOpenFile);

  const invalidate = useCallback(() => {
    request.current = null;
    setState({ phase: "idle" });
  }, []);

  useLayoutEffect(() => {
    invalidate();
    return () => {
      request.current = null;
    };
  }, [
    selectedTarget?.targetIndex,
    selectedTarget?.filePath,
    available,
    invalidate,
  ]);

  const selectTarget = (index: number) => {
    if (index === selectedTarget?.targetIndex) return;
    if (!targets.some((target) => target.targetIndex === index)) return;
    invalidate();
    setSelectedIndex(index);
  };

  const open = async () => {
    if (!selectedTarget || !onOpenFile || request.current) return;
    const token = {};
    request.current = token;
    setState({ phase: "opening" });
    try {
      await onOpenFile(selectedTarget);
      if (request.current !== token) return;
      setState({ phase: "requested" });
    } catch (error) {
      if (request.current !== token) return;
      setState({
        phase: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (request.current === token) request.current = null;
    }
  };

  return {
    selectedTarget,
    selectTarget,
    desktopAction: onOpenFile && selectedTarget ? { state, open } : undefined,
    reset: () => {
      invalidate();
      setSelectedIndex(targets[0]?.targetIndex);
    },
  };
}
