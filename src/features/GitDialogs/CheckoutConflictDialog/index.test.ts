// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { SwitchPreparation } from "@src/api/http/git/branchSwitch";
import { useTestTranslation } from "@src/test/i18nTestTranslate";

import { BranchSwitchDialogView, createBranchSwitchDialog } from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: (...args: Parameters<typeof useTestTranslation>) =>
    useTestTranslation(...args),
}));
let container: HTMLDivElement;
let root: Root;
const scope = { repoId: "repo", repoPath: "/repo" };
const preparation: SwitchPreparation = {
  current_branch: "main",
  target_branch: "develop",
  fingerprint: "1",
  changed_files: ["file.txt"],
  default_strategy: "leave",
  same_branch: false,
  blocked: null,
};
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});
async function render(extra = {}) {
  const onChoice = vi.fn(),
    onClose = vi.fn();
  await act(async () => {
    root.render(
      React.createElement(BranchSwitchDialogView, {
        scope,
        preparation,
        busy: false,
        onChoice,
        onClose,
        ...extra,
      })
    );
  });
  return { onChoice, onClose };
}
function button(label: string) {
  const el = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === label
  );
  expect(el).toBeTruthy();
  return el!;
}
it("uses real SelectionGrid radio rows with both descriptions and exclusive selection", async () => {
  const { onChoice } = await render();
  const leave = document.querySelector<HTMLButtonElement>(
    '[data-testid="selection-grid-option-leave"]'
  )!;
  const bring = document.querySelector<HTMLButtonElement>(
    '[data-testid="selection-grid-option-bring"]'
  )!;
  expect(leave.textContent).toContain("Leave changes on main");
  expect(leave.textContent).toContain("Save your work for later");
  expect(bring.textContent).toContain("Move your uncommitted changes");
  expect(
    document.querySelectorAll(
      '[data-testid^="selection-grid-option-"][aria-pressed]'
    )
  ).toHaveLength(2);
  await act(async () => bring.click());
  expect(
    document.querySelectorAll(
      '[data-testid^="selection-grid-option-"][aria-pressed="true"]'
    )
  ).toHaveLength(1);
  await act(async () => button("Switch branch").click());
  expect(onChoice).toHaveBeenCalledWith("bring");
});
it("honors the default strategy for new branches", async () => {
  const { onChoice } = await render({
    preparation: { ...preparation, default_strategy: "bring" },
  });
  await act(async () => button("Switch branch").click());
  expect(onChoice).toHaveBeenCalledWith("bring");
});
it("blocks cancellation and changing strategy while the operation is running", async () => {
  const { onChoice, onClose } = await render({ busy: true });
  expect(button("Cancel").disabled).toBe(true);
  const option = document.querySelector<HTMLButtonElement>(
    '[data-testid="selection-grid-option-bring"]'
  )!;
  expect(option.disabled).toBe(true);
  await act(async () => {
    option.click();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
  });
  expect(onChoice).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
it("reports the actual branch and conflict paths", async () => {
  await render({
    result: {
      outcome: "switched_with_conflicts",
      current_branch: "develop",
      message: "Original work is saved",
      snapshot_id: "1",
      conflicts: ["conflict.txt"],
    },
  });
  expect(document.body.textContent).toContain("Current branch: develop");
  expect(document.body.textContent).toContain("conflict.txt");
  expect(button("Close")).toBeTruthy();
  expect(
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent === "Cancel"
    )
  ).toBe(false);
});
it("cancel disposes the operation root and resolves once without a write", async () => {
  const controller = createBranchSwitchDialog(scope);
  let choice: Promise<string>;
  await act(async () => {
    choice = controller.choose(preparation);
  });
  await act(async () => button("Cancel").click());
  expect(await choice!).toBe("cancel");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("hides the repo path and reveals changed files behind a chevron toggle", async () => {
  await render({
    preparation: { ...preparation, changed_files: ["src/deep/file.txt"] },
  });
  expect(document.body.textContent).not.toContain("/repo");
  const toggle = document.querySelector<HTMLButtonElement>(
    "button[aria-expanded]"
  )!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(toggle.querySelector('[data-icon="chevron-right"]')).toBeTruthy();
  expect(document.body.textContent).not.toContain("file.txt");
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  const row = document.querySelector('li[title="src/deep/file.txt"]');
  expect(row?.textContent).toBe("file.txtsrc/deep");
});
