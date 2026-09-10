// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { Placeholder } from "@src/components/Placeholder";

import DocumentOpenMenu from "./index";

vi.mock("./documentApplications", () => ({
  loadDocumentApplications: vi.fn().mockResolvedValue([]),
  openDocument: vi.fn(),
}));
vi.mock("@src/util/platform/tauri", () => ({
  isMacOS: () => false,
  isTauriDesktop: () => true,
}));
vi.mock("react-i18next", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock("@src/components/Message", () => ({ default: { error: vi.fn() } }));
vi.mock("@src/components/Button", () => ({
  default: ({
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) =>
    React.createElement("button", props),
}));

it.each(["standalone", "placeholder"])(
  "opens real dropdown options from the %s button",
  async (triggerLocation) => {
    const environment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previous = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          triggerLocation === "placeholder"
            ? React.createElement(Placeholder, {
                variant: "empty",
                placement: "detail-panel",
                title: "Unsupported file type",
                action: {
                  label: "Open in…",
                  renderButton: (button) =>
                    React.createElement(
                      DocumentOpenMenu,
                      {
                        filePath: "/example.numbers",
                        hasUnsavedChanges: false,
                      },
                      button
                    ),
                },
              })
            : React.createElement(DocumentOpenMenu, {
                filePath: "/example.csv",
                hasUnsavedChanges: false,
              })
        )
      );
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
          .click()
      );
      const list = container.querySelector('[role="listbox"]');
      expect(list).not.toBeNull();
      const surface = list!.closest<HTMLElement>(".bg-bg-2");
      expect(surface).not.toBeNull();
      for (const token of [
        "border",
        "border-border-2",
        "rounded-lg",
        "shadow-dropdown",
        "w-max",
      ]) {
        expect(surface!.classList.contains(token)).toBe(true);
      }
      expect(surface?.style.minWidth).toBe("100%");
      expect(surface?.classList.contains("w-max")).toBe(true);
      expect(list!.textContent).toContain("documentOpen.defaultApp");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      environment.IS_REACT_ACT_ENVIRONMENT = previous;
    }
  }
);
