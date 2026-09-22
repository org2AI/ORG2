/**
 * @vitest-environment jsdom
 */
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import InlineInfoCard, { type InlineInfoCardProps } from "./InlineInfoCard";
import { InlineSurfaceProvider } from "./inlineSurface";

/** The `<td>` measurement shim: content cannot force the cell wider, and the
 *  card is inset inside the row. */
const TABLE_SHIM = "w-0 max-w-full min-w-full overflow-hidden px-2 py-2";

// React's createElement overload does not infer required children from its
// trailing arguments, so the props object is cast (see ScrollPreservation.test).
function card(props: Partial<InlineInfoCardProps>): React.ReactElement {
  return createElement(InlineInfoCard, props as InlineInfoCardProps, "body");
}

function onBlockSurface(child: React.ReactElement): string {
  return renderToStaticMarkup(
    createElement(
      InlineSurfaceProvider,
      { surface: "block" } as React.ComponentProps<
        typeof InlineSurfaceProvider
      >,
      child
    )
  );
}

describe("InlineInfoCard", () => {
  it("keeps the table-cell shim by default", () => {
    const markup = renderToStaticMarkup(card({ dataTestId: "card" }));

    expect(markup).toContain(TABLE_SHIM);
    expect(markup).toContain("rounded-lg border border-border-2");
  });

  it("drops the shim on a block surface, leaving one card layer", () => {
    const markup = onBlockSurface(card({ dataTestId: "card" }));

    expect(markup).not.toContain("min-w-full");
    expect(markup).not.toContain("px-2 py-2");
    // Exactly one element, and it is the card itself.
    expect(markup.match(/<div/g)).toHaveLength(1);
    expect(markup).toContain("rounded-lg border border-border-2");
    expect(markup).toContain('data-testid="card"');
  });

  it("still applies className and contentClassName on a block surface", () => {
    const markup = onBlockSurface(
      card({ className: "outer-class", contentClassName: "content-class" })
    );

    expect(markup).toContain("outer-class");
    expect(markup).toContain("content-class");
  });
});
