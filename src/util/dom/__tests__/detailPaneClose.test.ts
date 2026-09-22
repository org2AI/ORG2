// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHAT_PANE_SURFACE_SELECTOR,
  DETAIL_PANE_CLOSE_ATTRIBUTE,
  DETAIL_PANE_SHORTCUT_CLOSE_EVENT,
  closeOpenDetailPane,
} from "../detailPaneClose";

interface CloseActionOptions {
  rendered?: boolean;
  disabled?: boolean;
}

/** Mount one close action the way `DetailPaneCloseAction` renders it. */
function mountCloseAction(
  parent: Element,
  { rendered = true, disabled = false }: CloseActionOptions = {}
) {
  const marker = document.createElement("span");
  marker.setAttribute(DETAIL_PANE_CLOSE_ATTRIBUTE, "");
  const button = document.createElement("button");
  button.disabled = disabled;
  // jsdom has no layout; stand in for `display: none` on a retained tab.
  button.checkVisibility = () => rendered;
  const onClose = vi.fn();
  marker.addEventListener(DETAIL_PANE_SHORTCUT_CLOSE_EVENT, onClose);
  marker.append(button);
  parent.append(marker);
  return onClose;
}

function mountPane(attribute?: string) {
  const pane = document.createElement("div");
  if (attribute) pane.setAttribute(attribute, "");
  document.body.append(pane);
  return pane;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("closeOpenDetailPane", () => {
  it("reports no open detail when only a placeholder is showing", () => {
    mountPane("data-workbench-surface");
    expect(closeOpenDetailPane()).toBe(false);
  });

  it("asks the open detail to close without pressing its x", () => {
    const pane = mountPane("data-workbench-surface");
    const onClose = mountCloseAction(pane);
    const onPressX = vi.fn();
    pane.querySelector("button")?.addEventListener("click", onPressX);

    expect(closeOpenDetailPane()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPressX).not.toHaveBeenCalled();
  });

  it("ignores a detail left open in a retained, hidden tab", () => {
    const onClose = mountCloseAction(mountPane(), { rendered: false });
    expect(closeOpenDetailPane()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores a detail in the pane hidden by the chat-focus toggle", () => {
    const pane = mountPane("data-workbench-surface");
    pane.setAttribute("aria-hidden", "true");
    const onClose = mountCloseAction(pane);
    expect(closeOpenDetailPane()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores a disabled close action", () => {
    const onClose = mountCloseAction(mountPane(), { disabled: true });
    expect(closeOpenDetailPane()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the WorkStation chord out of the chat pane's detail", () => {
    const chatClose = mountCloseAction(mountPane("data-fullmode-chat-wrapper"));
    const stationClose = mountCloseAction(mountPane("data-workbench-surface"));

    expect(closeOpenDetailPane({ outside: CHAT_PANE_SURFACE_SELECTOR })).toBe(
      true
    );
    expect(stationClose).toHaveBeenCalledTimes(1);
    expect(chatClose).not.toHaveBeenCalled();
  });

  it("keeps the chat pane's chord inside the chat pane", () => {
    const chatPane = mountPane("data-fullmode-chat-wrapper");
    const stationClose = mountCloseAction(mountPane("data-workbench-surface"));

    expect(closeOpenDetailPane({ within: chatPane })).toBe(false);
    const chatClose = mountCloseAction(chatPane);
    expect(closeOpenDetailPane({ within: chatPane })).toBe(true);
    expect(chatClose).toHaveBeenCalledTimes(1);
    expect(stationClose).not.toHaveBeenCalled();
  });

  it("does nothing while the scoping pane is not mounted", () => {
    const onClose = mountCloseAction(mountPane());
    expect(closeOpenDetailPane({ within: null })).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the nested detail before the one that contains it", () => {
    const pane = mountPane("data-workbench-surface");
    const outerClose = mountCloseAction(pane);
    const innerClose = mountCloseAction(pane);

    expect(closeOpenDetailPane()).toBe(true);
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });
});
