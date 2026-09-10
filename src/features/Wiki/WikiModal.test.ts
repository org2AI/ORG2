// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WikiModal from "./WikiModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("WikiModal", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    function Host() {
      const [open, setOpen] = useState(true);
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "button",
          { onClick: () => setOpen(true), "data-testid": "reopen" },
          "Reopen"
        ),
        React.createElement(WikiModal, {
          open,
          onClose: () => setOpen(false),
        })
      );
    }
    act(() =>
      root.render(
        React.createElement(
          Provider,
          { store: createStore() },
          React.createElement(Host)
        )
      )
    );
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.resetAllMocks();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });
  function click(id: string) {
    const button = document.querySelector<HTMLButtonElement>(
      `[data-testid="${id}"]`
    );
    expect(button?.tagName).toBe("BUTTON");
    act(() => button!.click());
  }
  function search(value: string) {
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Search the wiki"]'
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  it("searches body content, selects an article and handles no results", () => {
    expect(document.querySelector("#wiki-article-title")?.textContent).toBe(
      "Adding keys: choose a method"
    );
    search("device authorization");
    expect(document.querySelector("#wiki-article-title")?.textContent).toBe(
      "Authentication by provider"
    );
    search("not-a-wiki-topic");
    expect(document.body.textContent).toContain("No articles match");
    search("");
    click("wiki-editor");
    expect(document.querySelector("#wiki-article-title")?.textContent).toBe(
      "Code Editor & source control"
    );
  });
  it("resets the wiki search after closing and reopening", () => {
    search("not-a-wiki-topic");
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    click("reopen");
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Search the wiki"]')
        ?.value
    ).toBe("");
  });
});
