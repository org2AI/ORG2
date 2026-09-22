import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import {
  ToolbarTooltip,
  ToolbarTooltipPositionProvider,
  type ToolbarTooltipProps,
} from "./ToolbarTooltip";

vi.mock("@src/components/Tooltip", () => ({
  default: (props: { position: string; smartPlacement: boolean }) =>
    createElement("span", {
      "data-position": props.position,
      "data-flips": String(props.smartPlacement),
    }),
}));

vi.mock("@src/components/KeyboardShortcut", () => ({
  KeyboardShortcutTooltipContent: () => null,
}));

vi.mock("@src/config/keyboard/useShortcutBindings", () => ({
  useShortcutKeys: () => undefined,
}));

function positionOf(node: ReactElement): string | undefined {
  return /data-position="([^"]+)"/.exec(renderToStaticMarkup(node))?.[1];
}

function tooltip(position?: ToolbarTooltipProps["position"]): ReactElement {
  const props = { label: "x", position } as ToolbarTooltipProps;
  return createElement(ToolbarTooltip, props, createElement("button"));
}

it("opens downward by default", () => {
  expect(positionOf(tooltip())).toBe("bottom");
});

it("opens where its toolbar says when the button does not", () => {
  expect(
    positionOf(
      createElement(ToolbarTooltipPositionProvider, { value: "top" }, tooltip())
    )
  ).toBe("top");
});

it("lets a button override its toolbar", () => {
  expect(
    positionOf(
      createElement(
        ToolbarTooltipPositionProvider,
        { value: "top" },
        tooltip("right")
      )
    )
  ).toBe("right");
});

it("flips sides to fit by default, but never under a toolbar's required side", () => {
  const flips = (node: ReactElement) =>
    /data-flips="([^"]+)"/.exec(renderToStaticMarkup(node))?.[1];

  expect(flips(tooltip())).toBe("true");
  expect(
    flips(
      createElement(ToolbarTooltipPositionProvider, { value: "top" }, tooltip())
    )
  ).toBe("false");
});
