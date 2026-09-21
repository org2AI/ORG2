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

import GitInitializationStatusMenu from "../GitInitializationStatusMenu";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  toggle: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("@src/hooks/dropdown", () => ({
  useDropdownEngine: () => ({
    close: mocks.close,
    isOpen: true,
    isPositioned: true,
    panelPosition: { top: 10, left: 10 },
    panelRef: { current: null },
    toggle: mocks.toggle,
    triggerRef: { current: null },
  }),
}));

vi.mock("../StatusBarTooltip", () => ({
  StatusBarTooltip: ({ children }: { children: React.ReactNode }) => children,
}));

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("GitInitializationStatusMenu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
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
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("opens the initialization action from the status-bar Git segment", async () => {
    const onInitialize = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        React.createElement(GitInitializationStatusMenu, {
          isInitializing: false,
          onInitialize,
        })
      );
    });

    expect(
      container.querySelector('[data-testid="status-bar-git-initialization"]')
        ?.textContent
    ).toContain("workstation.notGitInitialized");

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="status-bar-git-initialize"]'
        )
        ?.click();
    });

    expect(mocks.close).toHaveBeenCalledOnce();
    expect(onInitialize).toHaveBeenCalledOnce();
  });

  it("shows a disabled initializing state", async () => {
    await act(async () => {
      root.render(
        React.createElement(GitInitializationStatusMenu, {
          isInitializing: true,
          onInitialize: vi.fn(),
        })
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="status-bar-git-initialization"]'
    );
    const action = document.querySelector<HTMLButtonElement>(
      '[data-testid="status-bar-git-initialize"]'
    );

    expect(trigger?.disabled).toBe(true);
    expect(trigger?.textContent).toContain("sourceControl.initializingGit");
    expect(action?.disabled).toBe(true);
  });
});
