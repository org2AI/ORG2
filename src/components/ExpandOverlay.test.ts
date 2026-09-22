// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import ExpandOverlay from "./ExpandOverlay";
import { ViewportLayoutMutationProvider } from "./ViewportLayoutMutationContext";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const reactEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("ExpandOverlay", () => {
  beforeAll(() => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("reveals a collapsed control only for its hovered or focused group", () => {
    const markup = renderToStaticMarkup(
      createElement(ExpandOverlay, {
        isExpanded: false,
        onToggle: vi.fn(),
        showLabel: true,
      })
    );

    expect(markup).toContain(
      "opacity-0 group-focus-within/expand:opacity-100 group-hover/expand:opacity-100"
    );
  });

  it("notifies the viewport before an actual expand control toggles layout", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const calls: string[] = [];

    act(() => {
      root.render(
        createElement(
          ViewportLayoutMutationProvider,
          { value: () => calls.push("before-layout-mutation") },
          createElement(ExpandOverlay, {
            isExpanded: false,
            onToggle: () => calls.push("toggle"),
            showLabel: true,
            alwaysShowControl: true,
          })
        )
      );
    });

    const button = host.querySelector("button");
    expect(button).not.toBeNull();
    act(() => button?.click());
    expect(calls).toEqual(["before-layout-mutation", "toggle"]);

    act(() => root.unmount());
    host.remove();
  });

  it("keeps its existing standalone behavior outside a managed viewport", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onToggle = vi.fn();

    act(() => {
      root.render(
        createElement(ExpandOverlay, {
          isExpanded: true,
          onToggle,
          showLabel: true,
        })
      );
    });
    act(() => host.querySelector("button")?.click());
    expect(onToggle).toHaveBeenCalledOnce();

    act(() => root.unmount());
    host.remove();
  });
});
