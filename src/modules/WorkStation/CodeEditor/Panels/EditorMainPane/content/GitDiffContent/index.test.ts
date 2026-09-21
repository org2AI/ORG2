// @vitest-environment jsdom
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import {
  clearGitDiffEditDrafts,
  restoreGitDiffEditDraft,
} from "@src/store/workstation/codeEditor/gitDiffEditDrafts";
import type { GitFile } from "@src/types/git/types";

import { GitDiffContent } from "./index";

vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/contexts/git/GitStatusContext/useGitStatus", () => ({
  useGitStatus: () => ({ forceRefresh: vi.fn(async () => undefined) }),
}));
vi.mock("./useGitDiffLoader", () => ({
  useGitDiffLoader: ({ gitFile }: { gitFile: GitFile }) => ({
    effectiveGitFile: gitFile,
    selfFetching: false,
  }),
}));
vi.mock("@src/components/Message", () => ({ Message: { success: vi.fn() } }));
vi.mock("@src/components/Placeholder", () => ({ Placeholder: () => null }));
vi.mock("@src/services/workStation/EditorService", () => ({
  EditorService: {},
}));
vi.mock("@src/store/ui", async () => {
  const { atom } = await import("jotai");
  return {
    activeStationChatVisibleAtom: atom(false),
    activeStatusBarCallbacksAtom: atom({}),
    addToAgentAtom: atom(null),
  };
});
vi.mock("@src/hooks/settings/useEditorDisplayToggles", () => ({
  useEditorDisplayToggles: () => ({
    lineNumbersEnabled: true,
    onLineNumbersChange: vi.fn(),
    wordWrapEnabled: false,
    onWordWrapChange: vi.fn(),
    highlightActiveLineEnabled: false,
    onHighlightActiveLineChange: vi.fn(),
  }),
}));
vi.mock("@src/store/workstation/codeEditor", async () => {
  const { atom } = await import("jotai");
  return { diffViewModeAtom: atom("unified") };
});
vi.mock("@src/features/CodeMirror", async () => {
  const React = await import("react");
  const Editor = ({
    newValue,
    onChange,
  }: {
    newValue: string;
    onChange: (value: string) => void;
  }) =>
    React.createElement("textarea", {
      value: newValue,
      onInput: (event: React.FormEvent<HTMLTextAreaElement>) =>
        onChange(event.currentTarget.value),
      readOnly: true,
    });
  return {
    CodeMirrorDiff: Editor,
    CodeMirrorConflictEditor: Editor,
    hasConflictMarkers: () => false,
  };
});
vi.mock("@src/modules/WorkStation/shared", async () => {
  const React = await import("react");
  const FloatingBar = Object.assign(
    () => React.createElement("div", { "data-unsaved-bar": true }),
    { Layer: ({ children }: { children: React.ReactNode }) => children }
  );
  return {
    FloatingBar,
    FileHeader: ({
      onSave,
      hasUnsavedChanges,
    }: {
      onSave: () => void;
      hasUnsavedChanges: boolean;
    }) =>
      React.createElement(
        "button",
        { "data-dirty": String(hasUnsavedChanges), onClick: onSave },
        "Save"
      ),
  };
});

it("production diff keeps its unsaved controls and latest editor body after a stale save finishes", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clearGitDiffEditDrafts();
  const container = document.createElement("div");
  const root = createRoot(container);
  const store = createStore();
  const file: GitFile = {
    id: "a",
    path: "/fixture/a.ts",
    status: "modified",
    staged: false,
    additions: 1,
    deletions: 1,
    oldContent: "old",
    newContent: "base",
  };
  let finish!: () => void;
  vi.mocked(writeTextFile).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const unsaved = vi.fn();
  const input = (text: string) => {
    const editor = container.querySelector("textarea")!;
    editor.value = text;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  };
  try {
    await act(async () =>
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(GitDiffContent, {
            gitFile: file,
            loading: false,
            onUnsavedChange: unsaved,
          })
        )
      )
    );
    act(() => input("v1"));
    await act(async () => container.querySelector("button")!.click());
    expect(writeTextFile).toHaveBeenCalledWith("/fixture/a.ts", "v1");
    await act(async () => {
      input("v2");
      finish();
    });
    expect(container.querySelector("textarea")!.value).toBe("v2");
    expect(container.querySelector("button")!.dataset.dirty).toBe("true");
    expect(container.querySelector("[data-unsaved-bar]")).not.toBeNull();
    expect(unsaved).toHaveBeenLastCalledWith(true);
    expect(restoreGitDiffEditDraft(file.path, "v1")).toBe("v2");
  } finally {
    act(() => root.unmount());
    clearGitDiffEditDrafts();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});

it("keeps the same file header mounted while the next file's diff loads", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  const root = createRoot(container);
  const store = createStore();
  const loaded: GitFile = {
    id: "a",
    path: "/fixture/a.ts",
    status: "modified",
    staged: false,
    additions: 1,
    deletions: 1,
    oldContent: "old",
    newContent: "new",
  };
  // Switching files hands over metadata first; the body arrives later.
  const pending: GitFile = {
    ...loaded,
    id: "b",
    path: "/fixture/b.ts",
    oldContent: undefined,
    newContent: undefined,
  };
  const render = (gitFile: GitFile) =>
    root.render(
      React.createElement(
        Provider,
        { store },
        React.createElement(GitDiffContent, { gitFile, loading: false })
      )
    );
  try {
    await act(async () => render(loaded));
    const header = container.querySelector("button");
    expect(header).not.toBeNull();
    await act(async () => render(pending));
    expect(container.querySelector("button")).toBe(header);
    await act(async () =>
      render({ ...pending, oldContent: "", newContent: "x" })
    );
    expect(container.querySelector("button")).toBe(header);
  } finally {
    act(() => root.unmount());
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
