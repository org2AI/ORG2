// @vitest-environment jsdom
import { writeTextFile } from "@tauri-apps/plugin-fs";
import React, { act, useLayoutEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  clearGitDiffEditDrafts,
  hasGitDiffEditDraft,
  restoreGitDiffEditDraft,
  setGitDiffEditDraft,
} from "@src/store/workstation/codeEditor/gitDiffEditDrafts";

import { useGitDiffEditing } from "./useGitDiffEditing";

vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: vi.fn() }));
const refreshed = vi.fn();
const failed = vi.fn();
let root: Root;
let controller: ReturnType<typeof useGitDiffEditing>;
const writes: Array<{ resolve: () => void; reject: (error: Error) => void }> =
  [];
function Harness({ path = "/fixture/A", disk = "base" }) {
  const value = useGitDiffEditing(path, disk, refreshed, failed);
  useLayoutEffect(() => {
    controller = value;
  });
  return null;
}
async function render(path = "/fixture/A", disk = "base") {
  await act(async () => {
    root.render(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(Harness, { path, disk })
      )
    );
  });
}
async function save() {
  let result!: Promise<void>;
  await act(async () => {
    result = controller.save();
  });
  return { result };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clearGitDiffEditDrafts();
  vi.clearAllMocks();
  writes.length = 0;
  vi.mocked(writeTextFile).mockImplementation(
    () =>
      new Promise<void>((resolve, reject) => writes.push({ resolve, reject }))
  );
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  clearGitDiffEditDrafts();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

it("keeps a same-batch newer edit dirty and rebases its draft for remount", async () => {
  await render();
  act(() => controller.edit("v1"));
  const first = await save();
  await act(async () => {
    controller.edit("v2");
    writes[0].resolve();
    await first.result;
  });
  expect(controller.editedContent).toBe("v2");
  expect(controller.hasUnsavedChanges).toBe(true);
  expect(restoreGitDiffEditDraft("/fixture/A", "v1")).toBe("v2");
  act(() => root.unmount());
  root = createRoot(document.createElement("div"));
  await render("/fixture/A", "v1");
  expect(controller.editedContent).toBe("v2");
  expect(controller.hasUnsavedChanges).toBe(true);
  const second = await save();
  await act(async () => {
    writes[1].resolve();
    await second.result;
  });
  expect(controller.hasUnsavedChanges).toBe(false);
  expect(hasGitDiffEditDraft("/fixture/A")).toBe(false);
});

it("snapshots consecutive edits and serial saves without dropping the pending indicator", async () => {
  await render();
  act(() => controller.edit("v1"));
  const first = await save();
  let second!: Promise<void>;
  await act(async () => {
    controller.edit("v2");
    second = controller.save();
  });
  expect(writeTextFile).toHaveBeenCalledTimes(1);
  await act(async () => {
    writes[0].resolve();
    await first.result;
  });
  expect(controller.saving).toBe(true);
  expect(controller.hasUnsavedChanges).toBe(true);
  expect(writeTextFile).toHaveBeenLastCalledWith("/fixture/A", "v2");
  await act(async () => {
    writes[1].resolve();
    await second;
  });
  expect(controller.saving).toBe(false);
  expect(controller.hasUnsavedChanges).toBe(false);
});

it("old A completion cannot clean B or the remounted A owner", async () => {
  await render();
  act(() => controller.edit("v1"));
  const first = await save();
  await render("/fixture/B", "B base");
  act(() => controller.edit("B draft"));
  await render("/fixture/A");
  act(() => controller.edit("v2"));
  await act(async () => {
    writes[0].resolve();
    await first.result;
  });
  expect(controller.editedContent).toBe("v2");
  expect(controller.hasUnsavedChanges).toBe(true);
  expect(controller.saving).toBe(false);
  expect(restoreGitDiffEditDraft("/fixture/A", "v1")).toBe("v2");
  expect(restoreGitDiffEditDraft("/fixture/B", "B base")).toBe("B draft");
  expect(refreshed).not.toHaveBeenCalled();
  act(() => controller.edit("v3"));
  expect(restoreGitDiffEditDraft("/fixture/A", "v1")).toBe("v3");
});

it("unmounted completion preserves a newer owner's draft and does not refresh", async () => {
  await render();
  act(() => controller.edit("v1"));
  const first = await save();
  act(() => root.unmount());
  root = createRoot(document.createElement("div"));
  setGitDiffEditDraft("/fixture/A", "base", "new owner");
  await act(async () => {
    writes[0].resolve();
    await first.result;
  });
  expect(restoreGitDiffEditDraft("/fixture/A", "v1")).toBe("new owner");
  expect(refreshed).not.toHaveBeenCalled();
});

it("saving in a still-mounted pane preserves a different pane's newer draft", async () => {
  await render();
  act(() => controller.edit("v1"));
  const first = await save();
  setGitDiffEditDraft("/fixture/A", "base", "other pane");
  await act(async () => {
    writes[0].resolve();
    await first.result;
  });
  expect(restoreGitDiffEditDraft("/fixture/A", "v1")).toBe("other pane");
  expect(controller.hasUnsavedChanges).toBe(false);
});

it("failure preserves input and draft, and retry can save an empty file", async () => {
  await render();
  act(() => controller.edit(""));
  const first = await save();
  expect(writeTextFile).toHaveBeenLastCalledWith("/fixture/A", "");
  await act(async () => {
    writes[0].reject(new Error("disk failure"));
    await first.result;
  });
  expect(controller.hasUnsavedChanges).toBe(true);
  expect(controller.saving).toBe(false);
  expect(restoreGitDiffEditDraft("/fixture/A", "base")).toBe("");
  expect(failed).toHaveBeenCalledTimes(1);
  const retry = await save();
  await act(async () => {
    writes[1].resolve();
    await retry.result;
  });
  expect(controller.editedContent).toBe("");
  expect(controller.hasUnsavedChanges).toBe(false);
});

it("discard during a pending write preserves the user's revert intent", async () => {
  await render();
  act(() => controller.edit("v1"));
  const first = await save();
  act(() => controller.discard());
  await act(async () => {
    writes[0].resolve();
    await first.result;
  });
  expect(controller.editedContent).toBe("base");
  expect(controller.hasUnsavedChanges).toBe(true);
  expect(restoreGitDiffEditDraft("/fixture/A", "v1")).toBe("base");
});
