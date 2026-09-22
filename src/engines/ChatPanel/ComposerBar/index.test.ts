// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import ComposerBar from ".";

vi.mock(
  "@src/engines/ChatPanel/InputArea/components/ContextInfoButton",
  async () => {
    const ReactModule = await import("react");
    return {
      default: (props: { variant?: string; compact?: boolean }) =>
        ReactModule.createElement("span", {
          "data-testid": "context-info",
          "data-variant": props.variant ?? "toolbar",
          "data-compact": String(Boolean(props.compact)),
        }),
    };
  }
);

describe("ComposerBar", () => {
  it.each([false, true])(
    "groups model controls with mode pills on the left (inline=%s)",
    (inlineLayout) => {
      const markup = renderToStaticMarkup(
        createElement(ComposerBar, {
          inlineLayout,
          editorSlot: createElement("span", null, "Editor"),
          pills: createElement("span", { "data-testid": "mode" }, "Plan"),
          modelPill: createElement("span", { "data-testid": "model" }, "Model"),
          submitButton: createElement(
            "span",
            { "data-testid": "send" },
            "Send"
          ),
        })
      );
      const document = new DOMParser().parseFromString(markup, "text/html");
      const model = document.querySelector('[data-testid="model"]')!;
      const group = model.parentElement!;

      expect(group.querySelector('[data-testid="context-info"]')).toBeNull();
      expect(group.querySelector('[data-testid="send"]')).toBeNull();
      expect(group.querySelector('[data-testid="mode"]')).not.toBeNull();
      expect(
        [...group.children].map((child) => child.getAttribute("data-testid"))
      ).toEqual(["mode", "model"]);
    }
  );

  it("uses the shared surface for the add-context trigger", () => {
    const markup = renderToStaticMarkup(
      createElement(ComposerBar, {
        onAddContent: vi.fn(),
        showContextInfo: false,
      })
    );

    expect(markup).toContain('data-testid="composer-add-context-button"');
    expect(markup).toContain("enabled:hover:bg-surface-hover!");
    expect(markup).not.toContain("bg-bg-2!");
    expect(markup).not.toContain("Skills &amp; Tools");
  });

  it("uses the same toolbar row beneath an editor slot", () => {
    const markup = renderToStaticMarkup(
      createElement(ComposerBar, {
        editorSlot: createElement("span", null, "Editor"),
        showContextInfo: false,
      })
    );

    expect(markup).toContain("flex w-full flex-col gap-2");
    expect(markup).toContain('data-editor-slot="true"');
    expect(markup).toContain(
      "h-9 min-h-9 w-full items-center justify-between pt-2"
    );
    expect(markup).toContain("flex min-w-0 items-center gap-0.5");
    expect(markup).not.toContain("display:grid");
  });

  it("rests stacked controls on the shell inset shared with the inline row", () => {
    const stacked = renderToStaticMarkup(
      createElement(ComposerBar, {
        editorSlot: createElement("span", null, "Editor"),
        showContextInfo: false,
      })
    );
    const toolbarClass = new DOMParser()
      .parseFromString(stacked, "text/html")
      .body.firstElementChild!.lastElementChild!.className.split(" ");

    // Spare row height above the 28px controls only, never beside or below
    // them, so + and send keep the inline row's position when it expands.
    expect(toolbarClass).toEqual(expect.arrayContaining(["h-9", "pt-2"]));
    expect(toolbarClass.some((name) => /^(p|px|pl|pr|pb|py)-/.test(name))).toBe(
      false
    );
  });

  it("places the editor between the controls in the inline row", () => {
    const markup = renderToStaticMarkup(
      createElement(ComposerBar, {
        inlineLayout: true,
        onAddContent: vi.fn(),
        editorSlot: createElement("span", null, "Editor"),
        pills: createElement("span", null, "Pills"),
        submitButton: createElement("span", null, "Send"),
      })
    );
    const row = new DOMParser().parseFromString(markup, "text/html").body
      .firstElementChild!;
    const [left, editor, right] = [...row.children];

    expect(row.className).toContain("flex w-full min-w-0 items-center");
    expect(row.children).toHaveLength(3);
    expect(
      left.querySelector('[data-testid="composer-add-context-button"]')
    ).not.toBeNull();
    expect(editor.getAttribute("data-editor-slot")).toBe("true");
    expect(editor.className).toContain("flex-1");
    expect(left.textContent).toBe("Pills");
    expect(right.textContent).toBe("Send");
    expect(
      right
        .querySelector('[data-testid="context-info"]')
        ?.getAttribute("data-variant")
    ).toBe("corner");
    expect(markup).not.toContain("h-9 min-h-9");
  });

  it("keeps the editor node mounted in place across compact and stacked moves", () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = (inlineLayout: boolean) =>
      act(() =>
        root.render(
          createElement(ComposerBar, {
            inlineLayout,
            showContextInfo: false,
            editorSlot: createElement("div", {
              contentEditable: true,
              "data-testid": "editor",
              tabIndex: 0,
            }),
          })
        )
      );

    try {
      render(false);
      const editor = container.querySelector<HTMLElement>(
        '[data-testid="editor"]'
      )!;
      editor.focus();

      render(true);
      expect(container.querySelector('[data-testid="editor"]')).toBe(editor);
      expect(document.activeElement).toBe(editor);

      render(false);
      expect(container.querySelector('[data-testid="editor"]')).toBe(editor);
      expect(document.activeElement).toBe(editor);
    } finally {
      act(() => root.unmount());
      container.remove();
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
  });
});
