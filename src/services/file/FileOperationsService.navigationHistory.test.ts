// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NavigationHistory } from "@src/services/navigation/NavigationHistory";

import { FileOperationsService } from "./FileOperationsService";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  openTab: vi.fn(),
  createFileTab: vi.fn(),
  state: {
    selectedFile: null as string | null,
    cursor: null as { line: number; column: number } | null,
  },
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  copyFile: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
}));

vi.mock("./FileService", () => ({
  FileService: {
    open: mocks.open,
    getSelectedFile: () => mocks.state.selectedFile,
  },
}));

vi.mock("@src/util/core/state/instrumentedStore", () => ({
  getInstrumentedStore: () => ({
    get: () => ({ cursor: mocks.state.cursor }),
  }),
}));

vi.mock("@src/services/workStation/EditorTabService", () => ({
  EditorTabService: { openTab: mocks.openTab },
}));

vi.mock("@src/store/workstation/tabs", () => ({
  createFileTab: mocks.createFileTab,
}));

// openAtLine is the single path every deliberate jump to a file location takes
// (navigation commands, the browser's source jumps, the source control context
// menu), so it is where back/forward history has to be produced. Before this,
// nothing populated the ring and back/forward could only ever refuse.
describe("FileOperationsService.openAtLine navigation history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    NavigationHistory.clearHistory();
    mocks.open.mockResolvedValue(undefined);
    mocks.createFileTab.mockImplementation((path: string) => ({ path }));
    mocks.state.selectedFile = null;
    mocks.state.cursor = null;
  });

  it("records the jump so the location can be returned to", async () => {
    await FileOperationsService.openAtLine("/repo/b.ts", 42);

    expect(NavigationHistory.getHistory().locations).toEqual([
      { filePath: "/repo/b.ts", line: 42, column: 1 },
    ]);
  });

  it("records the origin first so back returns where the jump started", async () => {
    mocks.state.selectedFile = "/repo/a.ts";
    mocks.state.cursor = { line: 10, column: 5 };

    await FileOperationsService.openAtLine("/repo/b.ts", 42);

    const { locations, index } = NavigationHistory.getHistory();
    expect(locations).toEqual([
      { filePath: "/repo/a.ts", line: 10, column: 5 },
      { filePath: "/repo/b.ts", line: 42, column: 1 },
    ]);
    expect(index).toBe(1);
    expect(NavigationHistory.back()).toEqual({
      filePath: "/repo/a.ts",
      line: 10,
      column: 5,
    });
  });

  it("does not record a jump that failed to open", async () => {
    mocks.open.mockRejectedValue(new Error("no such file"));

    const result = await FileOperationsService.openAtLine("/repo/gone.ts", 3);

    expect(result.success).toBe(false);
    expect(NavigationHistory.getHistory().locations).toEqual([]);
  });

  it("does not rewrite history while a back/forward step is replaying", async () => {
    mocks.state.selectedFile = "/repo/a.ts";
    mocks.state.cursor = { line: 10, column: 5 };
    await FileOperationsService.openAtLine("/repo/b.ts", 42);
    const before = NavigationHistory.getHistory();

    await NavigationHistory.replay(() =>
      FileOperationsService.openAtLine("/repo/a.ts", 10)
    );

    expect(NavigationHistory.getHistory().locations).toEqual(before.locations);
  });
});
