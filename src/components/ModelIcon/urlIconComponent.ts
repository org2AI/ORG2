import {
  type FC,
  type Ref,
  type SVGProps,
  createElement,
  forwardRef,
} from "react";

import type { ModelIconSource } from "./iconProviders";

const urlIconComponents = new Map<string, FC<SVGProps<SVGSVGElement>>>();

/**
 * Adapt a glyph source to the svgr component shape callers already render
 * (`<Icon width height className style />`). URL sources get a memoized
 * `<img>` component so identity stays stable across renders.
 */
export function toIconComponent(
  source: ModelIconSource
): FC<SVGProps<SVGSVGElement>> {
  if (typeof source !== "string") return source;
  const cached = urlIconComponents.get(source);
  if (cached) return cached;
  // Pass the remaining props through so wrappers that tag the glyph
  // (`agentIcons.tsx` sets data-icon / data-brand) keep working; only the
  // SVG-paint props that mean nothing on an <img> are dropped.
  const UrlIcon = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
    (
      {
        width,
        height,
        className,
        style,
        fill: _fill,
        stroke: _stroke,
        strokeWidth: _strokeWidth,
        color: _color,
        viewBox: _viewBox,
        ...rest
      },
      ref
    ) =>
      createElement("img", {
        ...rest,
        src: source,
        width,
        height,
        className,
        style,
        alt: "",
        "aria-hidden": "true",
        draggable: false,
        ref: ref as unknown as Ref<HTMLImageElement>,
      })
  );
  UrlIcon.displayName = "UrlModelIcon";
  const component = UrlIcon as unknown as FC<SVGProps<SVGSVGElement>>;
  urlIconComponents.set(source, component);
  return component;
}
