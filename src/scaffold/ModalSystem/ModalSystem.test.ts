// @vitest-environment jsdom
/**
 * Opening focus for every dialog built on the shared Modal.
 *
 * The rule: when a dialog opens, the caret lands in the first field the user
 * is expected to fill. Before this was enforced here, the header's close
 * button won — it is the first focusable node in DOM order — and the modal's
 * own deferred focus call also stole focus back from fields that had set
 * `autoFocus` themselves.
 */
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import Modal from "./index";

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

/** Past the modal's deferred focus tick. */
const OPEN_FOCUS_DELAY_MS = 150;

describe("Modal opening focus", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("renders optional artwork before the title without changing confirmation actions", async () => {
    const onOk = vi.fn();
    const onCancel = vi.fn();
    act(() => {
      root.render(
        createElement(Modal, {
          visible: true,
          title: "Sign out?",
          image: { src: "/sign-out.png", alt: "A person waving goodbye" },
          onOk,
          onCancel,
          okText: "Sign out",
          cancelText: "Stay signed in",
        })
      );
    });
    const image = document.querySelector<HTMLImageElement>(
      ".liquid-modal-image"
    )!;
    expect(image.getAttribute("src")).toBe("/sign-out.png");
    expect(image.alt).toBe("A person waving goodbye");
    expect(image.parentElement!.firstElementChild).toBe(image);
    expect(
      document.querySelector('[role="dialog"]')?.getAttribute("aria-label")
    ).toBe("Sign out?");
    const buttons = Array.from(document.querySelectorAll("button"));
    act(() =>
      buttons.find((button) => button.textContent === "Stay signed in")!.click()
    );
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onOk).not.toHaveBeenCalled();
    await act(async () => {
      buttons.find((button) => button.textContent === "Sign out")!.click();
    });
    expect(onOk).toHaveBeenCalledOnce();

    act(() =>
      root.render(createElement(Modal, { visible: true, title: "Plain modal" }))
    );
    expect(document.querySelector(".liquid-modal-image")).toBeNull();
    expect(
      document.querySelector('[role="dialog"]')?.getAttribute("aria-label")
    ).toBe("Plain modal");
  });

  it("allows decorative artwork without an accessible image name", () => {
    act(() =>
      root.render(
        createElement(Modal, {
          visible: true,
          title: "Sign out?",
          image: { src: "/sign-out.png", alt: "" },
        })
      )
    );
    expect(
      document.querySelector(".liquid-modal-image")?.getAttribute("alt")
    ).toBe("");
  });

  function openModal(children: React.ReactNode) {
    act(() => {
      root.render(
        createElement(
          Modal,
          { visible: true, title: "Create channel" },
          children
        )
      );
    });
    act(() => {
      vi.advanceTimersByTime(OPEN_FOCUS_DELAY_MS);
    });
  }

  it("focuses the first field instead of the header close button", () => {
    openModal([
      createElement("input", { key: "name", "data-testid": "name" }),
      createElement("input", { key: "topic", "data-testid": "topic" }),
    ]);

    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="name"]')
    );
  });

  it("focuses a textarea when it is the first field", () => {
    openModal(createElement("textarea", { "data-testid": "body" }));

    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="body"]')
    );
  });

  it("skips disabled and read-only fields", () => {
    openModal([
      createElement("input", { key: "a", disabled: true, "data-testid": "a" }),
      createElement("input", { key: "b", readOnly: true, "data-testid": "b" }),
      createElement("input", { key: "c", "data-testid": "c" }),
    ]);

    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="c"]')
    );
  });

  it("ignores checkboxes and radios, which are actions rather than entry", () => {
    openModal([
      createElement("input", {
        key: "opt",
        type: "checkbox",
        "data-testid": "opt",
      }),
      createElement("input", { key: "name", "data-testid": "name" }),
    ]);

    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="name"]')
    );
  });

  it("leaves focus where the body put it", () => {
    // `autoFocus` inside a dialog body is an explicit choice by its author;
    // the deferred focus must not pull the caret back to the first field.
    openModal([
      createElement("input", { key: "first", "data-testid": "first" }),
      createElement("input", {
        key: "second",
        autoFocus: true,
        "data-testid": "second",
      }),
    ]);

    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="second"]')
    );
  });

  it("still falls back to the primary action when there is no field", () => {
    openModal(
      createElement(
        "button",
        {
          type: "button",
          "data-modal-primary-action": true,
          "data-testid": "ok",
        },
        "OK"
      )
    );

    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="ok"]')
    );
  });

  it("places supplied header actions before the close button", () => {
    act(() => {
      root.render(
        createElement(
          Modal,
          {
            visible: true,
            title: "Quota",
            headerActions: createElement(
              "button",
              { "data-testid": "refresh" },
              "Refresh"
            ),
          },
          createElement("div", null, "Body")
        )
      );
    });

    const refresh = document.querySelector('[data-testid="refresh"]');
    const close = document.querySelector('button[title="Close"]');
    if (!refresh || !close) {
      throw new Error("Expected the refresh action and close button");
    }
    expect(
      refresh.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("places the reusable back action before the title", () => {
    const onBack = vi.fn();
    act(() => {
      root.render(
        createElement(
          Modal,
          { visible: true, title: "Cookie", onBack, backLabel: "Return" },
          createElement("div", null, "Body")
        )
      );
    });

    const back = document.querySelector<HTMLButtonElement>(
      'button[title="Return"]'
    );
    const title = document.querySelector(".liquid-modal-content .truncate");
    const close = document.querySelector('button[title="Close"]');
    if (!back || !title || !close) {
      throw new Error("Expected the back button, title, and close button");
    }

    expect(
      back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      title.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    back.click();
    expect(onBack).toHaveBeenCalledOnce();
    expect(back.getAttribute("aria-label")).toBe("Return");

    const icon = back.querySelector('[data-icon="arrow-left"]');
    expect(icon).not.toBeNull();
  });
  it("names JSX-title dialogs without including header actions", () => {
    act(() =>
      root.render(
        createElement(Modal, {
          visible: true,
          title: createElement("span", null, "Move session to organization"),
          headerActions: createElement("button", null, "Help"),
        })
      )
    );
    const dialog = document.querySelector('[role="dialog"]')!;
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toBe(
      "Move session to organization"
    );
  });

  it("supports an explicit name without a header", () => {
    act(() =>
      root.render(
        createElement(Modal, { visible: true, "aria-label": "Sign in" })
      )
    );
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-label")).toBe("Sign in");
    expect(dialog.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("keeps string names and gives simultaneous JSX titles unique ids", () => {
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          createElement(Modal, { visible: true, title: "Plain title" }),
          createElement(Modal, {
            visible: true,
            title: createElement("span", null, "First"),
          }),
          createElement(Modal, {
            visible: true,
            title: createElement("span", null, "Second"),
          })
        )
      )
    );
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    expect(dialogs[0].getAttribute("aria-label")).toBe("Plain title");
    const ids = dialogs
      .slice(1)
      .map((dialog) => dialog.getAttribute("aria-labelledby"));
    expect(new Set(ids).size).toBe(2);
    expect(ids.map((id) => document.getElementById(id!)?.textContent)).toEqual([
      "First",
      "Second",
    ]);
  });
});
