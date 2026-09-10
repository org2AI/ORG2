import { beforeEach, describe, expect, it, vi } from "vitest";

import { repoApi } from "@src/api/tauri/repo";

import { importWorkingDirectoryPath } from "./workingDirectoryPathImport";

vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn() }));
vi.mock("@src/api/tauri/repo", () => ({
  repoApi: { validateWorkspacePath: vi.fn() },
}));

const validateWorkspacePath = vi.mocked(repoApi.validateWorkspacePath);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("importWorkingDirectoryPath", () => {
  it("validates pasted paths through the backend and imports the canonical path", async () => {
    validateWorkspacePath.mockResolvedValue("/canonical/repo");
    const onImportWorkingDirectory = vi.fn().mockResolvedValue(undefined);

    await expect(
      importWorkingDirectoryPath({
        candidatePath: "  /workspace/repo  ",
        invalidPathTitle: "Invalid path",
        invalidPathMessage: (path) => `Invalid: ${path}`,
        onImportWorkingDirectory,
      })
    ).resolves.toBe(true);

    expect(validateWorkspacePath).toHaveBeenCalledWith("/workspace/repo");
    expect(onImportWorkingDirectory).toHaveBeenCalledWith("/canonical/repo");
  });

  it("reports a backend validation failure as an invalid path", async () => {
    validateWorkspacePath.mockRejectedValue(new Error("not a directory"));
    const onImportWorkingDirectory = vi.fn();

    await expect(
      importWorkingDirectoryPath({
        candidatePath: "/workspace/missing",
        invalidPathTitle: "Invalid path",
        invalidPathMessage: (path) => `Invalid: ${path}`,
        onImportWorkingDirectory,
      })
    ).resolves.toBe(true);

    expect(onImportWorkingDirectory).not.toHaveBeenCalled();
  });
});
