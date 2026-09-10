// @vitest-environment jsdom
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

import TurnCollapsePinBar from "./TurnCollapsePinBar";

const { setOverride, replayEventById, replayState } = vi.hoisted(() => ({
  setOverride: vi.fn(),
  replayEventById: vi.fn(),
  replayState: { canReplay: false },
}));

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtomValue: () => new Map(),
  useSetAtom: () => setOverride,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key}:${Object.values(values).join("-")}` : key,
  }),
}));

vi.mock("@src/engines/ChatPanel/hooks/useChatEventReplay", () => ({
  useChatEventReplay: () => ({ ...replayState, replayEventById }),
}));

describe("TurnCollapsePinBar", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    replayState.canReplay = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.getSelection()?.removeAllRanges();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("does not make the duration and time range selectable", () => {
    act(() => {
      root.render(
        createElement(TurnCollapsePinBar, {
          turnId: "turn-1",
          durationMs: 42_000,
          startMs: new Date("2026-08-28T14:27:00Z").getTime(),
          endMs: new Date("2026-08-28T14:27:42Z").getTime(),
          defaultCollapsed: true,
          turnCollapseInteractionAtRef: { current: 0 },
        })
      );
    });

    const timing = container.querySelector<HTMLSpanElement>("button > span");
    expect(timing?.classList.contains("select-none")).toBe(true);
    expect(timing?.querySelector(".select-text")).toBeNull();
  });

  it("keeps the collapsed or expanded content separated below the divider", () => {
    act(() => {
      root.render(
        createElement(TurnCollapsePinBar, {
          turnId: "turn-1",
          durationMs: 42_000,
          startMs: new Date("2026-08-28T14:27:00Z").getTime(),
          endMs: new Date("2026-08-28T14:27:42Z").getTime(),
          defaultCollapsed: true,
          turnCollapseInteractionAtRef: { current: 0 },
        })
      );
    });

    expect(container.firstElementChild?.classList.contains("pb-2")).toBe(true);
  });

  it("temporarily hides the divider while the collapse row is hovered", () => {
    act(() => {
      root.render(
        createElement(TurnCollapsePinBar, {
          turnId: "turn-1",
          durationMs: 42_000,
          startMs: new Date("2026-08-28T14:27:00Z").getTime(),
          endMs: new Date("2026-08-28T14:27:42Z").getTime(),
          defaultCollapsed: true,
          turnCollapseInteractionAtRef: { current: 0 },
        })
      );
    });

    const row = container.querySelector(".chat-block-header");
    const divider = container.querySelector('[aria-hidden="true"]');
    expect(row?.classList.contains("peer/turn-collapse")).toBe(true);
    expect(
      divider?.classList.contains("peer-hover/turn-collapse:opacity-0")
    ).toBe(true);
  });

  it.each([true, false])(
    "toggles on the first click outside the chevron with selected transcript text (collapsed=%s)",
    async (defaultCollapsed) => {
      act(() => {
        root.render(
          createElement(TurnCollapsePinBar, {
            turnId: "turn-1",
            durationMs: 42_000,
            startMs: 1_000,
            endMs: 43_000,
            defaultCollapsed,
            turnCollapseInteractionAtRef: { current: 0 },
          })
        );
      });
      const transcript = document.createElement("p");
      transcript.textContent = "Previously selected transcript text";
      container.appendChild(transcript);
      const range = document.createRange();
      range.selectNodeContents(transcript);
      window.getSelection()?.addRange(range);
      expect(window.getSelection()?.isCollapsed).toBe(false);

      const button = container.querySelector<HTMLButtonElement>("button")!;
      const label = button.querySelector<HTMLSpanElement>("span > span")!;
      await act(async () => {
        label.click();
      });
      expect(setOverride).toHaveBeenCalledOnce();
      expect(setOverride).toHaveBeenCalledWith({
        turnId: "turn-1",
        collapsed: !defaultCollapsed,
      });
      expect(button.classList.contains("h-full")).toBe(true);
      expect(button.classList.contains("px-2")).toBe(true);
    }
  );

  it("reserves a fixed right-side replay slot and keeps replay clicks separate", async () => {
    replayState.canReplay = true;
    for (const defaultCollapsed of [true, false]) {
      act(() => {
        root.render(
          createElement(TurnCollapsePinBar, {
            turnId: "turn-1",
            durationMs: 42_000,
            startMs: 1_000,
            endMs: 43_000,
            defaultCollapsed,
            turnCollapseInteractionAtRef: { current: 0 },
          })
        );
      });
      const navigate = container.querySelector<HTMLButtonElement>(
        '[data-testid="event-navigate"]'
      )!;
      expect(navigate.classList.contains("w-5")).toBe(true);
      expect(navigate.classList.contains("w-0")).toBe(false);
      expect(navigate.parentElement?.classList.contains("absolute")).toBe(true);
      expect(navigate.parentElement?.classList.contains("right-2")).toBe(true);
      expect(navigate.parentElement?.classList.contains("w-5")).toBe(true);
      await act(async () => {
        navigate.click();
      });
    }
    expect(replayEventById).toHaveBeenCalledTimes(2);
    expect(replayEventById).toHaveBeenCalledWith("turn-1");
    expect(setOverride).not.toHaveBeenCalled();
  });

  it("shows a loading indicator after the time range while expanding", async () => {
    let resolveExpand: (() => void) | undefined;
    const onExpand = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveExpand = resolve;
        })
    );

    act(() => {
      root.render(
        createElement(TurnCollapsePinBar, {
          turnId: "turn-1",
          durationMs: 42_000,
          startMs: new Date("2026-08-28T14:27:00Z").getTime(),
          endMs: new Date("2026-08-28T14:27:42Z").getTime(),
          defaultCollapsed: true,
          turnCollapseInteractionAtRef: { current: 0 },
          onExpand,
        })
      );
    });

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-expanded="false"]'
    );
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    const loading = container.querySelector(
      '[data-testid="turn-collapse-loading"]'
    );
    const timing = container.querySelector<HTMLSpanElement>("button > span");
    expect(onExpand).toHaveBeenCalledOnce();
    expect(timing?.lastElementChild).toBe(loading);
    expect(loading?.classList.contains("text-primary-6")).toBe(true);
    expect(loading?.getAttribute("aria-label")).toBe("common:status.loading");

    await act(async () => {
      resolveExpand?.();
      await Promise.resolve();
    });
    expect(
      container.querySelector('[data-testid="turn-collapse-loading"]')
    ).toBeNull();
  });
});
