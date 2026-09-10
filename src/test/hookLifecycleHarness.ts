import { StrictMode, createElement, useLayoutEffect } from "react";

import { createSmokeRoot } from "./reactSmokeHarness";

/** Real effects/cleanup; every remount gets a new React root and DOM container. */
export function createHookLifecycleHarness<Props extends object, Result>(
  useHook: (props: Props) => Result
) {
  let root: ReturnType<typeof createSmokeRoot> | null = null;
  let committed: { value: Result } | null = null;

  function Probe(props: Props) {
    const value = useHook(props);
    useLayoutEffect(() => {
      committed = { value };
    }, [value]);
    return null;
  }

  return {
    async render(props: Props) {
      root ??= createSmokeRoot();
      await root.render(
        createElement(StrictMode, null, createElement(Probe, props))
      );
    },
    read(): Result {
      if (!committed)
        throw new Error("Render the hook before reading its committed value");
      return committed.value;
    },
    async unmount() {
      await root?.unmount();
      root = null;
      committed = null;
    },
  };
}
