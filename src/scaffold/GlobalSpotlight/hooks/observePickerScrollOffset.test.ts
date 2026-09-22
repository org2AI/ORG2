// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { observePickerScrollOffset } from "./observePickerScrollOffset";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const element = document.createElement("div");
  const onChange = vi.fn();
  const stop = observePickerScrollOffset(
    {
      scrollElement: element,
      targetWindow: window,
      options: { isScrollingResetDelay: 150 },
    },
    onChange
  )!;
  const scroll = (offset: number) => {
    element.scrollTop = offset;
    element.dispatchEvent(new Event("scroll"));
  };
  return { onChange, stop, scroll };
}

describe("picker scroll observer lifetime", () => {
  it("coalesces scroll completion to one timer with the latest offset", () => {
    const { onChange, stop, scroll } = setup();
    scroll(10);
    vi.advanceTimersByTime(100);
    scroll(20);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(149);
    expect(onChange.mock.calls).toEqual([
      [10, true],
      [20, true],
    ]);
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenLastCalledWith(20, false);
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it("cancels the trailing callback and listener when the picker closes", () => {
    const { onChange, stop, scroll } = setup();
    scroll(30);
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    scroll(40);
    vi.advanceTimersByTime(200);
    expect(onChange.mock.calls).toEqual([[30, true]]);
    stop();
  });
});
