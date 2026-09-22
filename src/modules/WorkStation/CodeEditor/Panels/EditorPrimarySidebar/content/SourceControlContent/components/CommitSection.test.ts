// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";

import { CommitSection, type CommitSectionProps } from "./CommitSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
it("keeps the original sidebar button and opens the message input in a modal", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const renderSection = (props: CommitSectionProps) =>
    createElement(MemoryRouter, null, createElement(CommitSection, props));
  const props: CommitSectionProps = {
    commitMessage: "",
    onCommitMessageChange: vi.fn(),
    onCommit: vi.fn(),
    onCommitAndPush: vi.fn(),
    commitLoading: false,
    canCommit: false,
    commitButtonText: "Commit all 2 files",
    isMerging: false,
    hasUnresolvedConflicts: false,
    hasStagedFiles: false,
    hasUnstagedFiles: true,
    showPublishButton: false,
    showCommitAndPublishButton: false,
    commitAndPublishButtonText: "Commit & Publish",
    publishLoading: false,
    showSyncButton: false,
    syncLoading: false,
    ahead: 0,
    behind: 0,
  };
  const onCommitAndPublish = vi.fn();
  const onAmend = vi.fn();
  const onCommitAndSync = vi.fn();
  try {
    act(() => root.render(renderSection(props)));
    expect(container.querySelector("textarea")).toBeNull();
    const launch = container.querySelector<HTMLButtonElement>(
      '[data-action="git.commit"]'
    )!;
    expect(launch.textContent).toBe("Commit all 2 files");
    expect(launch.disabled).toBe(false);
    act(() => launch.click());
    const modal = document.querySelector('[role="dialog"]')!;
    expect(modal.closest("[data-spotlight-container]")).not.toBeNull();
    expect(modal.querySelector("textarea")).toBe(document.activeElement);
    expect(
      modal.querySelector<HTMLButtonElement>('[data-action="git.commit"]')!
        .disabled
    ).toBe(true);
    expect(props.onCommit).not.toHaveBeenCalled();
    const disabledActions = [
      ...modal.querySelectorAll<HTMLButtonElement>("button[data-action]"),
    ];
    expect(disabledActions).toHaveLength(2);
    disabledActions.forEach((button) => {
      expect(button.disabled).toBe(true);
      act(() => button.click());
    });
    expect(props.onCommitAndPush).not.toHaveBeenCalled();
    act(() =>
      root.render(
        renderSection({
          ...props,
          commitMessage: "Update files",
          canCommit: true,
          showCommitAndPublishButton: true,
          onCommitAndPublish,
          onAmend,
          onCommitAndSync,
        })
      )
    );
    expect(modal.querySelector('button[aria-haspopup="menu"]')).toBeNull();
    expect(modal.querySelector(".spotlight-search-bar")).not.toBeNull();
    const buttons = [
      ...modal.querySelectorAll<HTMLButtonElement>("button[data-action]"),
    ];
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Commit all 2 files",
      "Commit (Amend)",
      "Commit & Push",
      "Commit & Publish",
      "Commit & Sync",
    ]);
    const handlers = [
      props.onCommit,
      onAmend,
      props.onCommitAndPush,
      onCommitAndPublish,
      onCommitAndSync,
    ];
    buttons.forEach((button, index) => {
      act(() => button.click());
      expect(handlers[index]).toHaveBeenCalledTimes(1);
    });
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-action="git.commit.publish"]')!
        .click()
    );
    expect(document.querySelector("textarea")!.value).toBe("Update files");
    act(() =>
      document
        .querySelector<HTMLButtonElement>(
          '.spotlight-search-bar [title="Commit"]'
        )!
        .click()
    );
    expect(document.querySelector("[data-spotlight-container]")).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
