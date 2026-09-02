// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConversationRuntimePill from "./ConversationRuntimePill";

vi.mock("jotai", () => ({
  useAtomValue: () => "dropdown",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === "common:actions.loading" ? "Loading..." : "Select an agent",
  }),
}));

vi.mock("@src/components/SelectorPill", () => ({
  default: ({
    label,
    disabled,
    dataTestId,
  }: {
    label: string;
    disabled?: boolean;
    dataTestId?: string;
  }) => (
    <button data-testid={dataTestId} disabled={disabled}>
      {label}
    </button>
  ),
}));

vi.mock("@src/components/AnyIcon", () => ({ default: () => <span /> }));
vi.mock("@src/components/ModelIcon", () => ({ default: () => <span /> }));
vi.mock("@src/config/agentIcons", () => ({
  resolveAgentIcon: () => undefined,
}));

vi.mock(
  "@src/scaffold/GlobalSpotlight/palettes/DispatchCategoryPalette",
  () => ({ DispatchCategoryPalette: () => null })
);
vi.mock(
  "@src/scaffold/GlobalSpotlight/palettes/DispatchCategoryPalette/DispatchCategoryDropdown",
  () => ({ DispatchCategoryDropdown: () => null })
);

describe("ConversationRuntimePill inventory readiness", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("does not paint a source runtime as selected while inventory loads", () => {
    act(() => {
      root.render(
        <ConversationRuntimePill
          readiness="loading"
          selection={{
            category: "cli_agent",
            targetKind: "cli_agent",
            cliAgentType: "codex",
            agentName: "Codex",
          }}
          allowedCliAgentTypes={[]}
          onSelect={vi.fn()}
        />
      );
    });

    const button = container.querySelector("button");
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toBe("Loading...");
    expect(container.textContent).not.toContain("Codex");
  });

  it("keeps an unavailable inventory neutral and disabled", () => {
    act(() => {
      root.render(
        <ConversationRuntimePill
          readiness="unavailable"
          selection={{
            category: "cli_agent",
            targetKind: "cli_agent",
            cliAgentType: "codex",
            agentName: "Codex",
          }}
          allowedCliAgentTypes={[]}
          onSelect={vi.fn()}
        />
      );
    });

    const button = container.querySelector("button");
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toBe("Select an agent");
    expect(container.textContent).not.toContain("Codex");
  });
});
