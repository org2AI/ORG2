// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import HarnessConnectionsSection from "./HarnessConnectionsSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/api/services/keyValidation", () => ({ saveKey: vi.fn() }));
vi.mock(
  "@src/modules/MainApp/Integrations/KeyVault/CliClients/CredentialImport/InlineCredentialImport",
  () => ({
    default: () => createElement("div", { "data-testid": "credential-import" }),
  })
);
vi.mock("@src/scaffold/WizardSystem/variants/KeyVault", () => ({
  KeyVaultWizard: () => null,
}));
vi.mock("./useHarnessConnection", () => ({
  refreshHarnessConnections: vi.fn(),
}));
vi.mock("./ProviderProfileEditor", () => ({
  default: ({
    target,
    onNavigationBlockedChange,
  }: {
    target: string;
    onNavigationBlockedChange: (blocked: boolean) => void;
  }) =>
    createElement(
      "section",
      { "data-target": target },
      createElement(
        "button",
        { onClick: () => onNavigationBlockedChange(true) },
        "busy"
      ),
      createElement(
        "button",
        { onClick: () => onNavigationBlockedChange(false) },
        "idle"
      )
    ),
}));
vi.mock("./HarnessConnectionEditor", () => ({
  default: ({ agentName }: { agentName: string }) =>
    createElement("section", { "data-target": agentName }),
}));

it("exposes separate Desktop and CLI selectors and mounts only the selected target", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(HarnessConnectionsSection))
    );
    expect(
      container.querySelector("section")?.getAttribute("data-target")
    ).toBe("claude_code");
    expect(container.textContent).not.toContain(
      "harnessConnections.description"
    );
    expect(
      container.querySelector('[data-testid="credential-import"]')
    ).not.toBeNull();
    const clickControl = async (label: string) => {
      const control = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === label
      )!;
      await act(async () => control.click());
    };
    await clickControl("busy");
    const codex = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Codex"
    )!;
    expect(codex.disabled).toBe(true);
    await act(async () => codex.click());
    expect(
      container.querySelector("section")?.getAttribute("data-target")
    ).toBe("claude_code");
    await clickControl("idle");
    expect(codex.disabled).toBe(false);
    for (const [label, target] of [
      ["Claude Desktop", "claude_desktop"],
      ["Codex", "codex"],
      ["Claude Code CLI", "claude_code"],
    ]) {
      const button = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === label
      )!;
      await act(async () => button.click());
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(container.querySelectorAll("section")).toHaveLength(1);
      expect(
        container.querySelector("section")?.getAttribute("data-target")
      ).toBe(target);
    }
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
