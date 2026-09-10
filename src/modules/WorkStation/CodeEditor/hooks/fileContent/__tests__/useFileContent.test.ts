// @vitest-environment jsdom
import { readTextFile } from "@tauri-apps/plugin-fs";
import React, { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearFileCache, getCachedBinaryStatus } from "../cache";
import { type UseFileContentReturn, useFileContent } from "../useFileContent";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async () => "text content"),
}));

vi.mock("../mtime", () => ({
  fetchFileMtime: vi.fn(async () => 123),
}));

describe("useFileContent binary tab lifecycle", () => {
  let root: Root;
  let state: UseFileContentReturn;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  function Probe({ filePath }: { filePath: string }) {
    const result = useFileContent({ filePath });
    useEffect(() => {
      state = result;
    }, [result]);
    return null;
  }

  async function selectFile(filePath: string) {
    await act(async () => {
      root.render(React.createElement(Probe, { filePath }));
    });
  }

  beforeEach(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    clearFileCache();
    vi.clearAllMocks();
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
    clearFileCache();
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it.each(["numbers", "pages", "zip"])(
    "preserves binary state when switching away from and back to .%s",
    async (extension) => {
      const filePath = `/repo/document.${extension}`;
      await selectFile(filePath);
      expect(state.isBinary).toBe(true);
      expect(state.contentReady).toBe(true);
      expect(getCachedBinaryStatus(filePath)).toBe(true);
      expect(readTextFile).not.toHaveBeenCalled();

      for (let cycle = 0; cycle < 2; cycle++) {
        await selectFile("/repo/notes.txt");
        expect(state.isBinary).toBe(false);
        expect(state.content).toBe("text content");

        await selectFile(filePath);
        expect(state.isBinary).toBe(true);
        expect(state.contentReady).toBe(true);
        expect(state.loading).toBe(false);
        expect(state.error).toBeNull();
        expect(state.hasUnsavedChanges).toBe(false);
      }

      expect(vi.mocked(readTextFile).mock.calls).toEqual([
        ["/repo/notes.txt"],
        ["/repo/notes.txt"],
      ]);

      act(() => root.unmount());
      root = createRoot(document.createElement("div"));
      await selectFile(filePath);
      expect(state.isBinary).toBe(true);
      expect(state.contentReady).toBe(true);
      expect(readTextFile).toHaveBeenCalledTimes(2);
    }
  );
});
