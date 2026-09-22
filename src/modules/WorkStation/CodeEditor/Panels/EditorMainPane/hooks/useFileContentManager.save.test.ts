// @vitest-environment jsdom
import { ask } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import React, { act, useLayoutEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  _resetUnsavedContentCacheForTests,
  clearFileCache,
} from "@src/modules/WorkStation/CodeEditor/hooks/fileContent/cache";

import { useFileContentManager } from "./useFileContentManager";

const disk = vi.hoisted(() => new Map<string, string>());
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => false) }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async (path: string) => disk.get(path) ?? `${path}-disk`),
  writeTextFile: vi.fn(),
}));
vi.mock("@src/modules/WorkStation/CodeEditor/hooks/fileContent/mtime", () => ({
  fetchFileMtime: vi.fn(async () => 1),
}));
let root: Root;
let controller: ReturnType<typeof useFileContentManager>;
const finish: (() => void)[] = [];
function Probe({ path = "/fixture/A.txt" }: { path?: string }) {
  const value = useFileContentManager({ activeFilePath: path });
  useLayoutEffect(() => {
    controller = value;
  });
  return null;
}
async function render(path?: string) {
  await act(async () => root.render(React.createElement(Probe, { path })));
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  _resetUnsavedContentCacheForTests();
  clearFileCache();
  finish.length = 0;
  disk.clear();
  vi.mocked(ask).mockClear();
  vi.mocked(writeTextFile)
    .mockReset()
    .mockImplementation(
      (path, content) =>
        new Promise<void>((r) => {
          finish.push(() => {
            disk.set(String(path), content);
            r();
          });
        })
    );
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => {
    for (const resolve of finish) resolve();
  });
  act(() => root.unmount());
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});
it("keeps newer input dirty after v1 save, then saves v2 and confirms its exact baseline", async () => {
  await render();
  act(() => controller.handleContentChange("v1"));
  let saving!: Promise<void>;
  await act(async () => {
    saving = controller.handleSave();
  });
  expect(writeTextFile).toHaveBeenCalledWith("/fixture/A.txt", "v1");
  act(() => controller.handleContentChange("v2"));
  await act(async () => {
    finish[0]();
    await saving;
  });
  expect(controller.content).toBe("v2");
  expect(controller.originalContent).toBe("v1");
  expect(controller.hasUnsavedChanges).toBe(true);
  await act(async () => {
    saving = controller.handleSave();
  });
  await act(async () => {
    finish[1]();
    await saving;
  });
  expect(controller.hasUnsavedChanges).toBe(false);
  expect(controller.originalContent).toBe("v2");
});
it("save completion from another document does not clean the active document", async () => {
  await render();
  act(() => controller.handleContentChange("A draft"));
  let saving!: Promise<void>;
  await act(async () => {
    saving = controller.handleSave();
  });
  await render("/fixture/B.txt");
  act(() => controller.handleContentChange("B draft"));
  await act(async () => {
    finish[0]();
    await saving;
  });
  expect(controller.content).toBe("B draft");
  expect(controller.hasUnsavedChanges).toBe(true);
  expect(controller.originalContent).toBe("/fixture/B.txt-disk");
});
it("failed save keeps dirty contents and retry succeeds", async () => {
  await render();
  act(() => controller.handleContentChange("retry"));
  vi.mocked(writeTextFile).mockRejectedValueOnce(new Error("disk failure"));
  await act(async () => controller.handleSave());
  expect(controller.hasUnsavedChanges).toBe(true);
  let saving!: Promise<void>;
  await act(async () => {
    saving = controller.handleSave();
  });
  await act(async () => {
    finish[0]();
    await saving;
  });
  expect(controller.hasUnsavedChanges).toBe(false);
});
it("keeps a same-batch edit dirty when the earlier write resolves before React commits", async () => {
  await render();
  act(() => controller.handleContentChange("v1"));
  let saving!: Promise<void>;
  await act(async () => {
    saving = controller.handleSave();
  });
  await act(async () => {
    controller.handleContentChange("v2");
    finish[0]();
    await saving;
  });
  expect(controller.content).toBe("v2");
  expect(controller.originalContent).toBe("v1");
  expect(controller.hasUnsavedChanges).toBe(true);
});

it("keeps the active file saving while another file finishes", async () => {
  await render();
  act(() => controller.handleContentChange("A draft"));
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = controller.handleSave();
  });
  await render("/fixture/B.txt");
  expect(controller.saving).toBe(false);
  act(() => controller.handleContentChange("B draft"));
  await act(async () => {
    second = controller.handleSave();
  });
  expect(controller.saving).toBe(true);
  await act(async () => {
    finish[0]();
    await first;
  });
  expect(controller.saving).toBe(true);
  await act(async () => {
    finish[1]();
    await second;
  });
  expect(controller.saving).toBe(false);
});
it("keeps saving true until all queued saves for the file settle", async () => {
  await render();
  act(() => controller.handleContentChange("v1"));
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = controller.handleSave();
  });
  act(() => controller.handleContentChange("v2"));
  await act(async () => {
    second = controller.handleSave();
  });
  await act(async () => {
    finish[0]();
    await first;
  });
  expect(controller.saving).toBe(true);
  expect(controller.hasUnsavedChanges).toBe(true);
  await act(async () => {
    finish[1]();
    await second;
  });
  expect(controller.saving).toBe(false);
  expect(controller.hasUnsavedChanges).toBe(false);
});

it("preserves external disk changes when overwrite is declined", async () => {
  await render();
  act(() => controller.handleContentChange("draft"));
  disk.set("/fixture/A.txt", "external edit");
  await act(async () => controller.handleSave());
  expect(ask).toHaveBeenCalledTimes(1);
  expect(writeTextFile).not.toHaveBeenCalled();
  expect(controller.hasUnsavedChanges).toBe(true);
  expect(controller.saving).toBe(false);
});
