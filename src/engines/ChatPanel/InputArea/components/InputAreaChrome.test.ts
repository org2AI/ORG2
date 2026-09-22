// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ComposerInputRef } from "@src/components/ComposerInput";

import {
  InputAreaTopRows,
  getComposerShellClassName,
  getComposerShellVariant,
} from "./InputAreaChrome";

vi.mock("../ChatHeader", () => ({ default: () => null }));
vi.mock("./PlanTodoPill", () => ({ default: () => null }));
vi.mock("./PinnedActionsBar/LazyPinnedActionsBar", async () => {
  const ReactModule = await import("react");
  return {
    default: ({ showPinnedActions }: { showPinnedActions?: boolean }) =>
      ReactModule.createElement("div", {
        "data-testid": "pinned-actions-bar",
        "data-visible": String(showPinnedActions),
      }),
  };
});

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("InputAreaTopRows", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("applies the supplied pinned-action visibility inside a session", () => {
    act(() => {
      root.render(
        createElement(InputAreaTopRows, {
          composerInputRef: createRef<ComposerInputRef>(),
          isEditMode: false,
          omitChatHeader: true,
          showPinnedActions: false,
        })
      );
    });

    const pinnedActions = container.querySelector(
      '[data-testid="pinned-actions-bar"]'
    );
    expect(pinnedActions?.getAttribute("data-visible")).toBe("false");
  });
});

describe("getComposerShellVariant", () => {
  const shellVariant = (
    overrides: Partial<Parameters<typeof getComposerShellVariant>[0]> = {}
  ) =>
    getComposerShellVariant({
      compactShell: false,
      isEditMode: false,
      quietEditSurface: false,
      surfaceBg: false,
      ...overrides,
    });

  it("wraps the compact row in the pill shell on any surface", () => {
    expect(shellVariant({ compactShell: true })).toBe("pill");
    expect(shellVariant({ compactShell: true, surfaceBg: true })).toBe("pill");
  });

  it("keeps the stacked shells when the row is not compact", () => {
    expect(shellVariant()).toBe("embedded");
    expect(shellVariant({ surfaceBg: true })).toBe("default");
    expect(shellVariant({ isEditMode: true })).toBe("embedded");
    expect(shellVariant({ isEditMode: true, quietEditSurface: true })).toBe(
      "historyEdit"
    );
  });
});

describe("getComposerShellClassName", () => {
  const base = {
    isDragOver: false,
    isEditMode: false,
    quietEditSurface: false,
  };

  it("keeps the composer glow by default", () => {
    expect(getComposerShellClassName(base)).toBe("composer-breathing");
  });

  it("marks the glow hidden when the preference is off", () => {
    expect(getComposerShellClassName({ ...base, glowVisible: false })).toBe(
      "composer-breathing composer-glow-hidden"
    );
  });
});
