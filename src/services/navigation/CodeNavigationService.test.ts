// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CodeNavigationService } from "./CodeNavigationService";
import { NavigationHistory } from "./NavigationHistory";

const mocks = vi.hoisted(() => ({
  gotoDefinition: vi.fn(),
  findReferences: vi.fn(),
  openAtLine: vi.fn(),
  goToPosition: vi.fn(),
  openSearchSidebar: vi.fn(),
  state: {
    selectedFile: null as string | null,
    cursor: null as { line: number; column: number } | null,
  },
}));

vi.mock("@src/api/tauri/search/symbol", () => ({
  gotoDefinition: mocks.gotoDefinition,
  findReferences: mocks.findReferences,
}));

vi.mock("@src/services/file/FileOperationsService", () => ({
  FileOperationsService: { openAtLine: mocks.openAtLine },
}));

vi.mock("@src/services/file/FileService", () => ({
  FileService: { getSelectedFile: () => mocks.state.selectedFile },
}));

vi.mock("@src/services/workStation/EditorService", () => ({
  EditorService: { goToPosition: mocks.goToPosition },
}));

vi.mock("@src/util/core/state/instrumentedStore", () => ({
  getInstrumentedStore: () => ({
    get: () => ({ cursor: mocks.state.cursor }),
  }),
}));

vi.mock("@src/services/workStation/WorkStationViewService", () => ({
  WorkStationViewService: { openSearchSidebar: mocks.openSearchSidebar },
}));

const location = (
  filePath: string,
  line: number,
  column = 1,
  text = "sym"
) => ({
  file_path: filePath,
  line,
  column,
  end_line: line,
  end_column: column + 3,
  text,
});

describe("CodeNavigationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    NavigationHistory.clearHistory();
    mocks.state.selectedFile = "/repo/a.ts";
    mocks.state.cursor = { line: 10, column: 5 };
    mocks.goToPosition.mockReturnValue(true);
    // Mirrors FileOperationsService.openAtLine, which records the jump it
    // performs; that contract has its own test in services/file. Without it
    // this suite could not catch a restore that rewrites the history it is
    // replaying.
    mocks.openAtLine.mockImplementation(async (path: string, line: number) => {
      NavigationHistory.recordVisit({ filePath: path, line, column: 1 });
      mocks.state.selectedFile = path;
      return { success: true };
    });
  });

  describe("goBack / goForward", () => {
    it("reports no previous location when nothing has been visited", async () => {
      await expect(CodeNavigationService.goBack()).resolves.toEqual({
        ok: false,
        message: "No previous location",
      });
      expect(mocks.openAtLine).not.toHaveBeenCalled();
    });

    it("reopens the previous location and then returns forward", async () => {
      NavigationHistory.recordVisit({
        filePath: "/repo/a.ts",
        line: 10,
        column: 5,
      });
      NavigationHistory.recordVisit({
        filePath: "/repo/b.ts",
        line: 42,
        column: 1,
      });
      mocks.state.selectedFile = "/repo/b.ts";

      const back = await CodeNavigationService.goBack();
      expect(back.ok).toBe(true);
      expect(mocks.openAtLine).toHaveBeenCalledWith("/repo/a.ts", 10);

      const forward = await CodeNavigationService.goForward();
      expect(forward.ok).toBe(true);
      expect(mocks.openAtLine).toHaveBeenLastCalledWith("/repo/b.ts", 42);
    });

    it("leaves the history untouched while replaying it", async () => {
      NavigationHistory.recordVisit({
        filePath: "/repo/a.ts",
        line: 10,
        column: 5,
      });
      NavigationHistory.recordVisit({
        filePath: "/repo/b.ts",
        line: 42,
        column: 1,
      });
      mocks.state.selectedFile = "/repo/b.ts";

      await CodeNavigationService.goBack();

      const { locations, index } = NavigationHistory.getHistory();
      expect(locations.map((entry) => entry.filePath)).toEqual([
        "/repo/a.ts",
        "/repo/b.ts",
      ]);
      expect(index).toBe(0);
    });

    it("keeps the cursor where it was when the file cannot be opened", async () => {
      NavigationHistory.recordVisit({
        filePath: "/repo/a.ts",
        line: 10,
        column: 5,
      });
      NavigationHistory.recordVisit({
        filePath: "/repo/b.ts",
        line: 42,
        column: 1,
      });
      mocks.state.selectedFile = "/repo/b.ts";
      mocks.openAtLine.mockResolvedValue({ success: false });

      const failed = await CodeNavigationService.goBack();
      expect(failed.ok).toBe(false);
      expect(NavigationHistory.getHistory().index).toBe(1);
    });
  });

  describe("goToDefinition", () => {
    it("jumps to the definition and records where it came from", async () => {
      mocks.gotoDefinition.mockResolvedValue([location("/repo/b.ts", 42, 3)]);

      const result = await CodeNavigationService.goToDefinition();

      expect(result.ok).toBe(true);
      expect(mocks.gotoDefinition).toHaveBeenCalledWith("/repo/a.ts", 10, 5);
      expect(mocks.openAtLine).toHaveBeenCalledWith("/repo/b.ts", 42);

      const { locations } = NavigationHistory.getHistory();
      expect(locations[0]).toEqual({
        filePath: "/repo/a.ts",
        line: 10,
        column: 5,
      });
    });

    it("moves the caret directly when the definition is in the open file", async () => {
      mocks.gotoDefinition.mockResolvedValue([location("/repo/a.ts", 80, 7)]);

      const result = await CodeNavigationService.goToDefinition();

      expect(result.ok).toBe(true);
      expect(mocks.goToPosition).toHaveBeenCalledWith(80, 7);
      expect(mocks.openAtLine).not.toHaveBeenCalled();
      expect(NavigationHistory.getHistory().locations).toHaveLength(2);
    });

    it("reports when the symbol has no definition", async () => {
      mocks.gotoDefinition.mockResolvedValue([]);

      await expect(CodeNavigationService.goToDefinition()).resolves.toEqual({
        ok: false,
        message: "No definition found under the cursor",
      });
      expect(mocks.openAtLine).not.toHaveBeenCalled();
    });

    it("reports when no file is open", async () => {
      mocks.state.selectedFile = null;

      await expect(CodeNavigationService.goToDefinition()).resolves.toEqual({
        ok: false,
        message: "No file is open",
      });
      expect(mocks.gotoDefinition).not.toHaveBeenCalled();
    });

    it("surfaces a failing lookup instead of reporting success", async () => {
      mocks.gotoDefinition.mockRejectedValue(new Error("unsupported language"));

      const result = await CodeNavigationService.goToDefinition();

      expect(result.ok).toBe(false);
      expect(result.message).toContain("unsupported language");
    });
  });

  describe("findReferences", () => {
    it("jumps straight to a lone reference", async () => {
      mocks.findReferences.mockResolvedValue([location("/repo/b.ts", 7, 2)]);

      const result = await CodeNavigationService.findReferences();

      expect(result.ok).toBe(true);
      expect(mocks.openAtLine).toHaveBeenCalledWith("/repo/b.ts", 7);
      expect(mocks.openSearchSidebar).not.toHaveBeenCalled();
    });

    it("opens the search sidebar on the symbol when there are several", async () => {
      mocks.findReferences.mockResolvedValue([
        location("/repo/b.ts", 7, 2, "useThing"),
        location("/repo/c.ts", 9, 4, "useThing"),
      ]);

      const result = await CodeNavigationService.findReferences();

      expect(result).toEqual({
        ok: true,
        message: 'Found 2 references to "useThing"',
      });
      expect(mocks.openSearchSidebar).toHaveBeenCalledWith("useThing");
      expect(mocks.openAtLine).not.toHaveBeenCalled();
    });

    it("reports when the symbol has no references", async () => {
      mocks.findReferences.mockResolvedValue([]);

      await expect(CodeNavigationService.findReferences()).resolves.toEqual({
        ok: false,
        message: "No references found under the cursor",
      });
    });
  });
});
