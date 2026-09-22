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

import { RoundNavigator } from "./RoundNavigator";

vi.mock("@src/components/BottomSheet", () => ({
  default: ({
    open,
    children,
  }: {
    open: boolean;
    children?: React.ReactNode;
  }) =>
    open
      ? React.createElement("div", { "data-testid": "round-sheet" }, children)
      : null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { current?: number }) =>
      ({
        "pagination.latestRound": "最新轮次",
        "pagination.round": `第 ${values?.current} 轮`,
        "common:pagination.latestRound": "最新轮次",
        "common:pagination.round": `第 ${values?.current} 轮`,
        "common:pagination.previousRound": "上一轮",
        "common:pagination.nextRound": "下一轮",
        "common:actions.close": "关闭",
        "common:actions.sort": "排序",
        "mobileRemote:rounds.navigationLabel": "会话轮次",
        "mobileRemote:rounds.incomplete": "仅显示最近轮次",
        "mobileRemote:rounds.truncated": "部分内容已截断",
      })[key] ?? key,
  }),
}));

describe("RoundNavigator", () => {
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
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  const rounds = [
    {
      id: "r1",
      startedAt: "2026-09-03T10:00:00.000Z",
      endedAt: "2026-09-03T10:01:00.000Z",
    },
    {
      id: "r2",
      startedAt: "2026-09-03T11:00:00.000Z",
      endedAt: "2026-09-03T11:02:00.000Z",
    },
    {
      id: "r3",
      startedAt: "2026-09-03T12:00:00.000Z",
      endedAt: "2026-09-03T12:03:00.000Z",
    },
  ];

  async function renderNavigator(
    selectedRoundId: string | null,
    onSelectRound: (roundId: string | null) => void,
    roundsComplete = true,
    truncated = false
  ) {
    await act(async () => {
      root.render(
        React.createElement(RoundNavigator, {
          rounds,
          roundsComplete,
          truncated,
          selectedRoundId,
          onSelectRound,
        })
      );
    });
  }

  function button(testId: string): HTMLButtonElement {
    const match = container.querySelector(
      `[data-testid="${testId}"]`
    ) as HTMLButtonElement | null;
    if (!match) throw new Error(`missing ${testId} button`);
    return match;
  }

  it("navigates previous, next, and latest with null follow-latest semantics", async () => {
    const onSelectRound = vi.fn();
    await renderNavigator(null, onSelectRound);
    expect(container.textContent).toContain("最新轮次");
    expect(button("turn-pagination-next-round").disabled).toBe(true);
    expect(button("turn-pagination-last-round").disabled).toBe(true);

    act(() => button("turn-pagination-previous-round").click());
    expect(onSelectRound).toHaveBeenLastCalledWith("r2");

    await renderNavigator("r1", onSelectRound);
    act(() => button("turn-pagination-next-round").click());
    expect(onSelectRound).toHaveBeenLastCalledWith("r2");

    await renderNavigator("r2", onSelectRound);
    act(() => button("turn-pagination-next-round").click());
    expect(onSelectRound).toHaveBeenLastCalledWith(null);
    act(() => button("turn-pagination-last-round").click());
    expect(onSelectRound).toHaveBeenLastCalledWith(null);
  });

  it("opens the round list from the selector trigger", async () => {
    await renderNavigator("r1", vi.fn());
    expect(container.querySelector('[data-testid="round-sheet"]')).toBeNull();
    act(() => button("turn-pagination-current-round").click());
    expect(
      container.querySelector('[data-testid="round-sheet"]')
    ).not.toBeNull();
  });

  it("labels a partial round directory without hiding navigation", async () => {
    await renderNavigator("r1", vi.fn(), false);
    expect(container.textContent).toContain("仅显示最近轮次");
    expect(button("turn-pagination-next-round").disabled).toBe(false);
  });

  it("keeps sorting inside the open sheet and marks the selected round", async () => {
    const onSelect = vi.fn();
    await renderNavigator("r1", onSelect);
    act(() => button("turn-pagination-current-round").click());
    const sheet = container.querySelector('[data-testid="round-sheet"]')!;
    const list = sheet.querySelector('[data-mobile-round-list="true"]')!;
    expect(list.querySelector("button")?.getAttribute("data-page-index")).toBe(
      "2"
    );
    expect(
      list
        .querySelector('[aria-current="true"]')
        ?.getAttribute("data-page-index")
    ).toBe("0");
    const sort = Array.from(sheet.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("rounds.newestFirst")
    )!;
    act(() => sort.click());
    expect(list.querySelector("button")?.getAttribute("data-page-index")).toBe(
      "0"
    );
    act(() =>
      (list.querySelector('[data-page-index="1"]') as HTMLButtonElement).click()
    );
    expect(onSelect).toHaveBeenCalledWith("r2");
    expect(container.querySelector('[data-testid="round-sheet"]')).toBeNull();
  });

  it("labels a truncated round body", async () => {
    await renderNavigator("r1", vi.fn(), true, true);
    expect(container.textContent).toContain("部分内容已截断");
  });

  it("places partial and truncated notes below navigation and removes them when complete", async () => {
    await renderNavigator("r1", vi.fn(), false, true);
    const nav = container.querySelector("nav")!;
    const note = nav.querySelector("[data-turn-navigation-status]")!;
    expect(note.parentElement).toBe(nav);
    expect(note.textContent).toBe("仅显示最近轮次 · 部分内容已截断");
    expect(button("turn-pagination-current-round").textContent).toBe("第 1 轮");
    expect(button("turn-pagination-next-round").disabled).toBe(false);

    await renderNavigator("r1", vi.fn(), true, false);
    expect(nav.querySelector("[data-turn-navigation-status]")).toBeNull();
    expect(button("turn-pagination-current-round").textContent).toBe("第 1 轮");
  });
});
