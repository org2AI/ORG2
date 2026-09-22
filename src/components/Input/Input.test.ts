// @vitest-environment jsdom
import React, { act } from "react";
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

import Input from ".";

vi.mock("@src/util/ui/theme/themeUtils", () => ({
  useCurrentTheme: () => ({ theme: "light", isDark: false }),
}));

function setInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Input", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("updates uncontrolled text and clears through the string change contract", () => {
    const observations: Array<{ value: string; eventValue: string }> = [];

    act(() => {
      root.render(
        React.createElement(Input, {
          defaultValue: "draft",
          allowClear: true,
          id: "field",
          onChange: (value, event) => {
            observations.push({ value, eventValue: event.target.value });
          },
        })
      );
    });

    const input = container.querySelector<HTMLInputElement>("#field");
    expect(input?.value).toBe("draft");

    act(() => {
      if (input) setInputValue(input, "updated");
    });
    expect(input?.value).toBe("updated");
    expect(observations).toEqual([{ value: "updated", eventValue: "updated" }]);

    act(() => {
      container.querySelector<HTMLButtonElement>(".input-clear")?.click();
    });
    expect(input?.value).toBe("");
    expect(observations.at(-1)).toEqual({ value: "", eventValue: "" });
    expect(container.querySelector(".input-clear")).toBeNull();
  });

  it("keeps controlled state external while reporting attempted edits", () => {
    const onChange = vi.fn();

    act(() => {
      root.render(
        React.createElement(Input, {
          value: "source",
          onChange,
          id: "field",
        })
      );
    });

    const input = container.querySelector<HTMLInputElement>("#field");
    act(() => {
      if (input) setInputValue(input, "attempted");
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0]?.[0]).toBe("attempted");
    expect(input?.value).toBe("source");
  });

  it("lets an explicit clear handler own the clear side effects", () => {
    const onChange = vi.fn();
    const onClear = vi.fn();

    act(() => {
      root.render(
        React.createElement(Input, {
          defaultValue: "draft",
          allowClear: true,
          onChange,
          onClear,
          id: "field",
        })
      );
    });

    const input = container.querySelector<HTMLInputElement>("#field");
    act(() => {
      container.querySelector<HTMLButtonElement>(".input-clear")?.click();
    });

    expect(onClear).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
    expect(input?.value).toBe("");
  });

  it("preserves field appearance, error layout, focus state, and native attributes", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();

    act(() => {
      root.render(
        React.createElement(Input, {
          type: "email",
          name: "contact",
          required: true,
          appearance: "ghost",
          size: "large",
          autoHeight: true,
          errorMessage: "Invalid address",
          errorPlacement: "left",
          prefix: React.createElement("span", null, "@"),
          suffix: React.createElement("span", null, ".com"),
          onFocus,
          onBlur,
          "aria-label": "Contact email",
          id: "field",
        })
      );
    });

    const input = container.querySelector<HTMLInputElement>("#field");
    const wrapper = container.querySelector<HTMLDivElement>(".input-wrapper");
    const inner = container.querySelector<HTMLDivElement>(".input-inner");

    expect(container.querySelector(".input-field-left")).not.toBeNull();
    expect(container.querySelector(".input-error-message")?.textContent).toBe(
      "Invalid address"
    );
    expect(wrapper?.classList.contains("input-error")).toBe(true);
    expect(wrapper?.classList.contains("input-field-ghost")).toBe(true);
    expect(wrapper?.classList.contains("input-size-large")).toBe(true);
    expect(wrapper?.classList.contains("input-auto-height")).toBe(true);
    expect(inner?.classList.contains("bg-bg-2")).toBe(false);
    expect(container.querySelector(".input-prefix")?.textContent).toBe("@");
    expect(container.querySelector(".input-suffix")?.textContent).toBe(".com");
    expect(input?.type).toBe("email");
    expect(input?.name).toBe("contact");
    expect(input?.required).toBe(true);
    expect(input?.getAttribute("aria-label")).toBe("Contact email");

    act(() => input?.focus());
    expect(wrapper?.classList.contains("input-focused")).toBe(true);
    expect(onFocus).toHaveBeenCalledOnce();

    act(() => input?.blur());
    expect(wrapper?.classList.contains("input-focused")).toBe(false);
    expect(onBlur).toHaveBeenCalledOnce();
  });

  it("renders inline confirm and cancel actions wired to Enter and Escape", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    act(() => {
      root.render(
        React.createElement(Input, {
          defaultValue: "draft",
          onConfirm,
          onCancel,
          confirmLabel: "Save name",
          cancelLabel: "Discard",
          id: "field",
        })
      );
    });

    const input = container.querySelector<HTMLInputElement>("#field");
    const inner = container.querySelector(".input-inner");
    const confirm =
      container.querySelector<HTMLButtonElement>(".input-confirm");
    const cancel = container.querySelector<HTMLButtonElement>(".input-cancel");

    expect(
      container
        .querySelector(".input-wrapper")
        ?.classList.contains("input-has-edit-actions")
    ).toBe(true);
    expect(
      inner?.lastElementChild?.classList.contains("input-edit-actions")
    ).toBe(true);
    expect(
      Array.from(
        container.querySelectorAll(".input-edit-actions > button"),
        (button) => button.getAttribute("aria-label")
      )
    ).toEqual(["Discard", "Save name"]);
    expect(cancel?.classList.contains("btn-hover:text-danger-6")).toBe(true);
    expect(confirm?.classList.contains("btn-hover:text-primary-6")).toBe(true);
    for (const action of [cancel, confirm]) {
      expect(action?.classList.contains("btn-hover:text-text-1")).toBe(false);
    }
    expect(confirm?.getAttribute("aria-label")).toBe("Save name");
    expect(cancel?.getAttribute("aria-label")).toBe("Discard");
    expect(confirm?.type).toBe("button");
    expect(confirm?.tabIndex).toBe(-1);

    act(() => {
      if (input) setInputValue(input, "renamed");
    });
    act(() => confirm?.click());
    expect(onConfirm).toHaveBeenLastCalledWith("renamed");

    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input?.dispatchEvent(enter);
    });
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(enter.defaultPrevented).toBe(true);

    act(() => cancel?.click());
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("blocks confirm while disabled or loading and ignores composing Enter", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const render = (props: Partial<React.ComponentProps<typeof Input>>) =>
      act(() => {
        root.render(
          React.createElement(Input, {
            value: "",
            onConfirm,
            onCancel,
            id: "field",
            ...props,
          })
        );
      });
    const pressKey = (key: string, init: KeyboardEventInit = {}) =>
      act(() => {
        container
          .querySelector("#field")
          ?.dispatchEvent(
            new KeyboardEvent("keydown", { key, bubbles: true, ...init })
          );
      });
    const button = (name: string) =>
      container.querySelector<HTMLButtonElement>(`.input-${name}`);

    render({ confirmDisabled: true });
    expect(button("confirm")?.disabled).toBe(true);
    expect(button("cancel")?.disabled).toBe(false);
    pressKey("Enter");
    expect(onConfirm).not.toHaveBeenCalled();

    render({ value: "name", confirmLoading: true });
    expect(button("confirm")?.disabled).toBe(true);
    expect(button("cancel")?.disabled).toBe(true);
    pressKey("Enter");
    pressKey("Escape");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    render({ value: "名前" });
    pressKey("Enter", { isComposing: true });
    expect(onConfirm).not.toHaveBeenCalled();
    pressKey("Enter");
    expect(onConfirm).toHaveBeenCalledWith("名前");
  });

  it("shows inline actions only while the value differs from savedValue", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const render = (value: string) =>
      act(() => {
        root.render(
          React.createElement(Input, {
            value,
            savedValue: "Harry",
            onConfirm,
            onCancel,
            id: "field",
          })
        );
      });
    const pressKey = (key: string) => {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        container.querySelector("#field")?.dispatchEvent(event);
      });
      return event;
    };

    render("Harry");
    expect(container.querySelector(".input-edit-actions")).toBeNull();
    expect(
      container
        .querySelector(".input-wrapper")
        ?.classList.contains("input-has-edit-actions")
    ).toBe(false);
    expect(pressKey("Enter").defaultPrevented).toBe(false);
    expect(pressKey("Escape").defaultPrevented).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    render("Harry He");
    expect(container.querySelector(".input-edit-actions")).not.toBeNull();
    pressKey("Enter");
    pressKey("Escape");
    expect(onConfirm).toHaveBeenCalledWith("Harry He");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("lets a caller key handler pre-empt the inline actions", () => {
    const onConfirm = vi.fn();

    act(() => {
      root.render(
        React.createElement(Input, {
          defaultValue: "draft",
          onConfirm,
          onKeyDown: (event) => event.preventDefault(),
          id: "field",
        })
      );
    });

    act(() => {
      container.querySelector("#field")?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(container.querySelector(".input-cancel")).toBeNull();
    expect(container.querySelector(".input-confirm")).not.toBeNull();
  });

  it("toggles password visibility without making the action a tab stop", () => {
    act(() => {
      root.render(
        React.createElement(Input, {
          type: "password",
          defaultValue: "secret",
          id: "field",
        })
      );
    });

    const input = container.querySelector<HTMLInputElement>("#field");
    const toggle = container.querySelector<HTMLButtonElement>(
      ".input-password-toggle"
    );

    expect(input?.type).toBe("password");
    expect(toggle?.type).toBe("button");
    expect(toggle?.tabIndex).toBe(-1);

    act(() => toggle?.click());
    expect(input?.type).toBe("text");

    act(() => toggle?.click());
    expect(input?.type).toBe("password");
  });
});
