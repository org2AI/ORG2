// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
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

import DropdownSearch from "./DropdownSearch";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "actions.search" ? "Localized Search" : key),
  }),
}));

describe("DropdownSearch", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

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

  it("focuses by default on each mount without refocusing on updates", () => {
    const renderSearch = (value: string) =>
      root.render(createElement(DropdownSearch, { value, onChange: vi.fn() }));

    act(() => renderSearch(""));
    act(() => vi.advanceTimersByTime(10));
    expect(document.activeElement).toBe(container.querySelector("input"));

    const button = document.createElement("button");
    container.appendChild(button);
    button.focus();
    act(() => renderSearch("query"));
    act(() => vi.advanceTimersByTime(10));
    expect(document.activeElement).toBe(button);
    button.remove();

    act(() => root.render(null));
    act(() => renderSearch(""));
    act(() => vi.advanceTimersByTime(10));
    expect(document.activeElement).toBe(container.querySelector("input"));
    act(() => vi.runAllTimers());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows callers to opt out of autofocus", () => {
    act(() => {
      root.render(
        createElement(DropdownSearch, {
          value: "",
          onChange: vi.fn(),
          autoFocus: false,
        })
      );
    });
    act(() => vi.advanceTimersByTime(10));
    expect(document.activeElement).not.toBe(container.querySelector("input"));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels pending focus when closed before the delay finishes", () => {
    act(() => {
      root.render(
        createElement(DropdownSearch, { value: "", onChange: vi.fn() })
      );
    });
    const input = container.querySelector("input")!;
    const focus = vi.spyOn(input, "focus");
    act(() => root.render(null));
    act(() => vi.advanceTimersByTime(10));
    expect(focus).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the concise localized search label by default", () => {
    const markup = renderToStaticMarkup(
      createElement(DropdownSearch, {
        value: "",
        onChange: vi.fn(),
      })
    );

    expect(markup).toContain('placeholder="Localized Search"');
    expect(markup).toContain('aria-label="Localized Search"');
    expect(markup).toContain('type="search"');
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain('spellCheck="false"');
  });

  it("supports custom and intentionally empty leading content", () => {
    const customMarkup = renderToStaticMarkup(
      createElement(DropdownSearch, {
        value: "",
        onChange: vi.fn(),
        leading: createElement("span", { "data-leading": true }, "Prefix"),
        containerClassName: "gap-2",
        testId: "search-row",
        type: "text",
      })
    );
    const iconlessMarkup = renderToStaticMarkup(
      createElement(DropdownSearch, {
        value: "",
        onChange: vi.fn(),
        leading: null,
      })
    );

    expect(customMarkup).toContain('data-testid="search-row"');
    expect(customMarkup).toContain('data-leading="true"');
    expect(customMarkup).toContain("gap-2");
    expect(customMarkup).toContain('type="text"');
    expect(iconlessMarkup).not.toContain('data-icon="search"');
  });

  it("forwards the input ref and composes native keyboard handling", () => {
    const onKeyDown = vi.fn();
    let inputRef: HTMLInputElement | null = null;

    act(() => {
      root.render(
        createElement(DropdownSearch, {
          value: "query",
          onChange: vi.fn(),
          onKeyDown,
          disabled: true,
          "data-search-input": "true",
          ref: (element) => {
            inputRef = element;
          },
        })
      );
    });

    const input = container.querySelector<HTMLInputElement>("input");
    expect(inputRef).toBe(input);
    expect(input?.disabled).toBe(true);
    expect(input?.dataset.searchInput).toBe("true");

    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      );
    });
    expect(onKeyDown).toHaveBeenCalledOnce();
  });
});
