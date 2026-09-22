// @vitest-environment jsdom
import { type ReactNode, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DETAIL_PANE_CLOSE_ATTRIBUTE,
  DETAIL_PANE_SHORTCUT_CLOSE_EVENT,
} from "@src/util/dom/detailPaneClose";

import DetailPaneLayout, {
  DetailPaneCloseAction,
  DetailPanePlaceholder,
} from "./DetailPaneLayout";
import { DetailPaneShortcutCloseContext } from "./detailPaneShortcutClose";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("@src/components/Placeholder", () => ({
  Placeholder: ({
    variant,
    placement,
    fillParentHeight,
  }: {
    variant: string;
    placement?: string;
    fillParentHeight?: boolean;
  }) =>
    createElement("div", {
      "data-placeholder-variant": variant,
      "data-placeholder-placement": placement,
      "data-fill-parent-height": String(fillParentHeight),
    }),
}));

vi.mock("@src/components/DetailHeaderIconAction", () => ({
  default: ({
    label,
    icon,
    testId,
  }: {
    label: string;
    icon: ReactNode;
    testId?: string;
  }) =>
    createElement(
      "button",
      { type: "button", "aria-label": label, "data-testid": testId },
      icon
    ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("DetailPaneLayout", () => {
  it("owns the shared right-pane header and full-height body", () => {
    const markup = renderToStaticMarkup(
      createElement(
        DetailPaneLayout,
        {
          header: {
            children: createElement("span", null, "Issue #42"),
            actions: createElement("button", { type: "button" }, "Close"),
          },
          testId: "detail-pane",
        },
        createElement("main", null, "Detail body")
      )
    );

    expect(markup).toContain('data-testid="detail-pane"');
    expect(markup).toContain('data-detail-pane-layout="true"');
    expect(markup).toContain("Issue #42");
    expect(markup).toContain("Close");
    expect(markup).toContain("Detail body");
    expect(markup).toContain("border-b");
    expect(markup).toContain("h-9");
    expect(markup).not.toContain("h-10");
    expect(markup).toContain("pl-4!");
    expect(markup).toContain("pr-[7px]!");
    expect(markup).toContain("data-detail-pane-body");
  });

  it("pins placeholders to the detail body placement", () => {
    const markup = renderToStaticMarkup(
      createElement(DetailPanePlaceholder, { variant: "loading" })
    );

    expect(markup).toContain('data-placeholder-variant="loading"');
    expect(markup).toContain('data-placeholder-placement="detail-panel"');
    expect(markup).toContain('data-fill-parent-height="true"');
  });

  it("keeps a close action in an otherwise empty detail header", () => {
    const markup = renderToStaticMarkup(
      createElement(
        DetailPaneLayout,
        {
          onClose: vi.fn(),
          closeTestId: "close-detail",
        },
        createElement(DetailPanePlaceholder, { variant: "empty" })
      )
    );

    expect(markup).toContain('data-testid="close-detail"');
    expect(markup).toContain('aria-label="actions.close"');
    // The close-tab chord finds the open detail through this marker.
    expect(markup).toMatch(/<span[^>]*data-detail-pane-close=""[^>]*><button/);
    expect(markup).toContain('data-icon="x"');
    expect(markup).toContain("border-b");
  });
});

describe("DetailPaneCloseAction", () => {
  async function mountCloseAction(onShortcutClose: (() => void) | null) {
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          DetailPaneShortcutCloseContext.Provider,
          { value: onShortcutClose },
          createElement(DetailPaneCloseAction, { onClose })
        )
      );
    });
    const sendShortcutClose = () =>
      container
        .querySelector(`[${DETAIL_PANE_CLOSE_ATTRIBUTE}]`)
        ?.dispatchEvent(new CustomEvent(DETAIL_PANE_SHORTCUT_CLOSE_EVENT));
    const unmount = async () => {
      await act(async () => root.unmount());
      container.remove();
    };
    return { onClose, sendShortcutClose, unmount };
  }

  it("closes like its x when the close-tab chord reaches it", async () => {
    const harness = await mountCloseAction(null);
    harness.sendShortcutClose();
    expect(harness.onClose).toHaveBeenCalledTimes(1);
    await harness.unmount();
  });

  it("lets the surface keep its split when the chord closes the detail", async () => {
    const onShortcutClose = vi.fn();
    const harness = await mountCloseAction(onShortcutClose);
    harness.sendShortcutClose();
    expect(onShortcutClose).toHaveBeenCalledTimes(1);
    expect(harness.onClose).not.toHaveBeenCalled();
    await harness.unmount();
  });
});
