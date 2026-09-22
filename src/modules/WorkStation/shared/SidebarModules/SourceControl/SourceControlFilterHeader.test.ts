// @vitest-environment jsdom
import { type ReactNode, act, createElement, isValidElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import SourceControlFilterHeader, {
  type SourceControlFilterHeaderProps,
} from "./SourceControlFilterHeader";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count: number; label: string }) =>
      options ? `${options.count} ${options.label}` : key,
  }),
}));
vi.mock("@src/components/Select", () => ({
  default: ({
    options,
    value,
    showTriggerIcon,
  }: {
    options: {
      value: string;
      icon?: unknown;
      label?: ReactNode;
      triggerLabel?: string;
    }[];
    showTriggerIcon?: boolean;
    value: string;
  }) =>
    createElement(
      "select",
      { value, readOnly: true, "data-trigger-icon": String(showTriggerIcon) },
      options.map((option) =>
        createElement(
          "option",
          {
            key: option.value,
            value: option.value,
            "data-has-icon": String(Boolean(option.icon)),
            "data-trigger-label": option.triggerLabel,
          },
          isValidElement<{ children: ReactNode }>(option.label)
            ? option.label.props.children
            : option.label
        )
      )
    ),
}));

it.each(["staged", "unstaged"] as const)(
  "hides redundant filters and leaves %s when the last staged change disappears",
  (mode) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const onChangeMode = vi.fn();
    let props: SourceControlFilterHeaderProps = {
      mode,
      onChangeMode,
      onRefresh: vi.fn(),
      showRefresh: false,
      counts: { uncommitted: 3, unstaged: 2, staged: 1, stashed: 0 },
    };
    const render = () =>
      act(() => root.render(createElement(SourceControlFilterHeader, props)));
    const values = () =>
      [...container.querySelectorAll("option")].map((option) => option.value);
    try {
      render();
      expect(container.querySelector("select")!.dataset.triggerIcon).toBe(
        "false"
      );
      expect(
        [...container.querySelectorAll("option")].every(
          (option) => option.dataset.hasIcon === "true"
        )
      ).toBe(true);
      expect(values()).toEqual([
        "uncommitted",
        "unstaged",
        "staged",
        "stashed",
        "history",
        "pr",
        "issues",
      ]);
      const uncommitted = container.querySelector(
        'option[value="uncommitted"]'
      )!;
      expect(uncommitted.getAttribute("data-trigger-label")).toBe(
        "controlTower.git.filterUncommitted"
      );
      expect(uncommitted.textContent).toBe(
        "3 controltower.git.filteruncommitted"
      );
      expect(onChangeMode).not.toHaveBeenCalled();
      props = {
        ...props,
        counts: { uncommitted: 3, unstaged: 3, staged: 0, stashed: 0 },
      };
      render();
      expect(values()).toEqual([
        "uncommitted",
        "stashed",
        "history",
        "pr",
        "issues",
      ]);
      expect(container.querySelector("select")!.value).toBe("uncommitted");
      expect(onChangeMode).toHaveBeenCalledWith("uncommitted");
      props = { ...props, mode: "history", counts: undefined };
      onChangeMode.mockClear();
      render();
      expect(values()).toContain("staged");
      expect(values()).toContain("unstaged");
      expect(onChangeMode).not.toHaveBeenCalled();
      props = {
        ...props,
        counts: { uncommitted: 0, unstaged: 0, staged: 0, stashed: 0 },
      };
      render();
      expect(container.querySelector("select")!.value).toBe("history");
      expect(onChangeMode).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  }
);
