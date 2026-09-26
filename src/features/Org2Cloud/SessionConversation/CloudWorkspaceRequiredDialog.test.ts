// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { openWorkingDirectorySpotlight } from "@src/scaffold/GlobalSpotlight/openSpotlight";

import { CloudWorkspaceRequiredDialog } from "./CloudWorkspaceRequiredDialog";
import { cloudWorkspaceRequiredDialogAtom } from "./cloudWorkspaceRequiredDialogAtom";

vi.mock("@src/scaffold/GlobalSpotlight/openSpotlight", () => ({
  openWorkingDirectorySpotlight: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "conversation.workspaceRequiredTitle": "Open a matching workspace",
        "conversation.workspaceRequiredBody":
          "Open the local repository checkout",
        "conversation.openWorkspace": "Open workspace",
      };
      return translations[key] ?? key;
    },
  }),
}));

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
});

it("opens the normal workspace picker from the missing-checkout prompt", () => {
  const store = createStore();
  store.set(cloudWorkspaceRequiredDialogAtom, true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(
        Provider,
        { store },
        createElement(CloudWorkspaceRequiredDialog)
      )
    );
  });

  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("Open a matching workspace");
  const open = [...(dialog?.querySelectorAll("button") ?? [])].find((button) =>
    button.textContent?.includes("Open workspace")
  );
  expect(open).toBeDefined();
  act(() => open?.click());
  expect(openWorkingDirectorySpotlight).toHaveBeenCalledWith("open");
  expect(store.get(cloudWorkspaceRequiredDialogAtom)).toBe(false);

  act(() => root.unmount());
  container.remove();
});
