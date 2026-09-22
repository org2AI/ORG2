/**
 * `createLazyTabRenderer` — the shared skeleton for tab renderers whose content
 * component is code-split behind `React.lazy`.
 *
 * Before this factory, every such renderer repeated the same four things:
 * a `React.lazy(() => import(…))`, a local `LazyFallback`, a `memo(...)` whose
 * only job was to read host context and map `tab.data` into the content
 * component's props, and a `displayName` assignment.
 *
 * CODE SPLITTING — read before changing this file:
 * the factory takes a LOADER THUNK, never a module specifier. The dynamic
 * `import("…")` must stay a literal inside the renderer module that owns it;
 * if it were moved behind a variable or a path argument here, webpack could no
 * longer statically see the request and would stop emitting a separate chunk
 * for that content component. `load` is passed straight to `React.lazy`, so the
 * split boundary is exactly where it was before.
 *
 * HOOKS — `useProps` is called unconditionally in the generated component's
 * render body, so it may (and usually does) call hooks such as
 * `useEditorHostContext`. It is named `use*` rather than `mapProps` precisely
 * so `react-hooks/rules-of-hooks` can see that and check it.
 */
import type { ComponentType } from "react";
import React, { Suspense, memo } from "react";

import LazyDetailFallback from "@src/components/layout/blocks/LazyDetailFallback";

import type { UnifiedTabContentProps } from "../types";

export interface LazyTabRendererConfig<TProps> {
  /**
   * Loader thunk for the content component. MUST contain the literal
   * `import("…")` — see the code-splitting note above.
   */
  load: () => Promise<{ default: ComponentType<TProps> }>;
  /** `displayName` for the generated renderer, e.g. `"GitDiffTabRenderer"`. */
  displayName: string;
  /**
   * Maps the dispatcher's generic tab props into the content component's props.
   * Runs in the render body, so it may call hooks.
   *
   * `NoInfer` is load-bearing: without it TypeScript infers `TProps` from this
   * return type instead of from `load`, and a renderer that omits a required
   * prop type-checks clean (the widened props object stays assignable in the
   * direction `load` is checked). With it, missing and mistyped props are
   * reported here, against the content component's real prop interface.
   *
   * KNOWN GAP vs. the hand-written `<Content … />` JSX it replaces: TypeScript
   * does not run its excess-property check against a deferred generic target,
   * so an EXTRA prop (a misspelled optional prop name, say `readonly` for
   * `readOnly`) is not reported here — it is silently dropped, exactly as an
   * unknown prop spread onto a component would be. Missing required props,
   * wrong types, and wrong callback signatures are all still caught. Verified
   * against TS 5.9 / tsgo; `NoInfer<TProps>`, a mapped type over it, and an
   * intersection all behave the same way, so this is not worth working around.
   */
  useProps: (props: UnifiedTabContentProps) => NoInfer<TProps>;
  /**
   * Optional React `key` for the content element, to force a remount when some
   * identity changes. Receives the tab props and the already-mapped content
   * props, so it needs no hooks of its own.
   */
  getKey?: (
    props: UnifiedTabContentProps,
    mapped: NoInfer<TProps>
  ) => React.Key;
}

/**
 * Builds a memoized tab renderer that suspends on `load` behind the shared
 * detail-panel loading fallback.
 */
export function createLazyTabRenderer<TProps>({
  load,
  displayName,
  useProps,
  getKey,
}: LazyTabRendererConfig<TProps>): React.FC<UnifiedTabContentProps> {
  const Content = React.lazy(load);

  const Renderer: React.FC<UnifiedTabContentProps> = memo((tabProps) => {
    const contentProps = useProps(tabProps);

    return (
      <Suspense fallback={<LazyDetailFallback />}>
        <Content
          key={getKey ? getKey(tabProps, contentProps) : undefined}
          {...contentProps}
        />
      </Suspense>
    );
  });

  Renderer.displayName = displayName;

  return Renderer;
}

export default createLazyTabRenderer;
