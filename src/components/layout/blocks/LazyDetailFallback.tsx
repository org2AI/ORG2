/**
 * LazyDetailFallback
 *
 * The standard `<Suspense fallback>` for a lazily-loaded detail surface that
 * owns the full height of its parent — tab contents, editor panes, and routed
 * detail panels.
 *
 * Before this existed, twelve modules each declared their own
 * `const LazyFallback = () => <Placeholder variant="loading" placement="detail-panel" fillParentHeight />`.
 *
 * NOTE: `fillParentHeight` is deliberately baked in and not a prop. Suspense
 * fallbacks that are NOT height-filling (the Settings / Integrations detail
 * panels, which render `<Placeholder variant="loading" placement="detail-panel" />`
 * inside an already-sized flex child) render a visibly different block and are
 * intentionally not routed through this component.
 */
import React, { memo } from "react";

import { Placeholder } from "@src/components/Placeholder";

const LazyDetailFallback: React.FC = memo(() => (
  <Placeholder variant="loading" placement="detail-panel" fillParentHeight />
));

LazyDetailFallback.displayName = "LazyDetailFallback";

/**
 * Pre-built element for `<Suspense fallback={…}>` call sites that want a stable
 * identity instead of constructing a fresh element per render.
 */
export const LAZY_DETAIL_FALLBACK = <LazyDetailFallback />;

export default LazyDetailFallback;
