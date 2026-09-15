// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import SearchInput from ".";

it("keeps all eight search actions named, compact and independently wired", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const callbacks = Array.from({ length: 8 }, () => vi.fn());
  try {
    await act(async () =>
      root.render(
        React.createElement(SearchInput, {
          value: "query",
          onChange: vi.fn(),
          showClearButton: true,
          onClear: callbacks[0],
          onCaseSensitiveToggle: callbacks[1],
          onWholeWordToggle: callbacks[2],
          onRegexToggle: callbacks[3],
          onOnlyOpenFilesToggle: callbacks[4],
          onPrevious: callbacks[5],
          onNext: callbacks[6],
          onClose: callbacks[7],
          caseSensitive: true,
          wholeWord: false,
          useRegex: true,
          onlyOpenFiles: false,
          multiline: true,
        })
      )
    );
    const buttons = Array.from(host.querySelectorAll("button"));
    expect(buttons).toHaveLength(8);
    for (const [index, button] of buttons.entries()) {
      expect(button.getAttribute("aria-label")).toBeTruthy();
      expect(button.style.height).toBe("20px");
      expect(button.style.width).toBe("20px");
      expect(button.type).toBe("button");
      expect(button.querySelector("svg")).not.toBeNull();
      await act(async () => button.click());
      expect(callbacks[index]).toHaveBeenCalledTimes(1);
    }
    expect(
      buttons.slice(1, 5).map((button) => button.getAttribute("aria-pressed"))
    ).toEqual(["true", "false", "true", "false"]);
    expect(buttons[1].className).toContain("text-primary-6");
    expect(buttons[2].className).toContain("text-text-2");
    expect(buttons[1].className).toContain("self-start");
    expect(parseFloat(buttons[1].style.marginTop)).toBeGreaterThan(0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});

it("preserves shared field refs, value callbacks, Enter behavior and multiline resize", async () => {
  const { default: ReplaceInput } =
    await import("@src/modules/WorkStation/CodeEditor/Panels/shared/ReplaceInput");
  const { default: SearchFilters } =
    await import("@src/modules/WorkStation/CodeEditor/Panels/shared/SearchFilters");
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    for (const Component of [SearchInput, ReplaceInput]) {
      for (const multiline of [false, true]) {
        const ref = React.createRef<HTMLInputElement | HTMLTextAreaElement>();
        const onChange = vi.fn();
        const onSubmit = vi.fn();
        const props = {
          value: "needle",
          onChange,
          onSubmit,
          multiline,
          inputRef: ref as React.RefObject<
            HTMLInputElement | HTMLTextAreaElement
          >,
        };
        await act(async () =>
          root.render(
            Component === SearchInput
              ? React.createElement(SearchInput, props)
              : React.createElement(ReplaceInput, props)
          )
        );
        const field = host.querySelector<
          HTMLInputElement | HTMLTextAreaElement
        >(multiline ? "textarea" : "input")!;
        expect(ref.current).toBe(field);
        expect(
          field.closest(
            multiline ? ".textarea-field-bare" : ".input-field-bare"
          )
        ).not.toBeNull();
        expect(field.value).toBe("needle");
        const enter = new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        });
        await act(async () => field.dispatchEvent(enter));
        expect(enter.defaultPrevented).toBe(true);
        expect(onSubmit).toHaveBeenCalledTimes(1);
        const shiftEnter = new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        await act(async () => field.dispatchEvent(shiftEnter));
        expect(shiftEnter.defaultPrevented).toBe(false);
        expect(onSubmit).toHaveBeenCalledTimes(1);
        if (multiline) {
          expect(parseFloat(field.style.minHeight)).toBe(0);
          Object.defineProperty(field, "scrollHeight", {
            configurable: true,
            value: 180,
          });
        }
        const prototype = multiline
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        await act(async () => {
          Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
            field,
            "updated"
          );
          field.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(onChange).toHaveBeenCalledWith("updated");
        if (multiline) expect(field.style.height).toBe("120px");
        else expect(field.style.height).toBe("28px");
      }
    }
    const include = vi.fn(),
      exclude = vi.fn();
    await act(async () =>
      root.render(
        React.createElement(SearchFilters, {
          filesToInclude: "src/**",
          filesToExclude: "dist/**",
          onFilesToIncludeChange: include,
          onFilesToExcludeChange: exclude,
        })
      )
    );
    for (const [id, callback] of [
      ["files-to-include", include],
      ["files-to-exclude", exclude],
    ] as const) {
      const field = host.querySelector<HTMLInputElement>(`#${id}`)!;
      expect(field.closest(".input-field-bare")).not.toBeNull();
      expect(host.querySelector(`label[for="${id}"]`)).not.toBeNull();
      expect(field.style.fontSize).toBe("13px");
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )!.set!.call(field, "*.ts");
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(callback.mock.calls[0][0]).toBe("*.ts");
    }
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
