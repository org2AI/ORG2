import { describe, expect, it, vi } from "vitest";

import type { WorkStationTab } from "@src/store/workstation/tabs/types";

import { executeUiRequest } from "./execute";
import type { UiDependencies } from "./execute";
import type { UiRequest } from "./protocol";

const request = (): UiRequest => ({
  protocolVersion: 1,
  requestId: "test",
  command: "ui.file.open",
  target: {
    instanceId: "instance",
    windowId: "main",
    workspace: { kind: "session", sessionId: "A" },
  },
  params: { path: "file.ts", line: 12 },
  reveal: false,
  timeoutMs: 1000,
});
const tab = {
  id: "file:/repo/file.ts",
  type: "file",
  title: "file.ts",
  data: { filePath: "/repo/file.ts", targetLine: 12 },
} as WorkStationTab;
function dependencies(): UiDependencies {
  return {
    terminal: { list: vi.fn(), open: vi.fn(), io: vi.fn() },
    permitted: () => true,
    active: async () => true,
    resolveWorkspace: () => ({ repoPath: "/repo" }),
    context: () => ({}),
    tabs: () => [],
    partition: () => "workspace",
    prepareFile: vi.fn(async () => "/repo/file.ts"),
    openFile: vi.fn(() => tab),
    openBuiltin: vi.fn(() => tab),
    openWeb: vi.fn(() => ({ tab, created: true })),
    focus: vi.fn(),
    reveal: vi.fn(() => false),
  };
}
describe("public UI producing boundary", () => {
  it("gates terminal writes with the app permission and requires explicit input params", async () => {
    const deps = dependencies();
    deps.permitted = () => false;
    const req = {
      ...request(),
      command: "ui.terminal.execute",
      params: { terminalId: "one", command: "echo test" },
    };
    expect((await executeUiRequest(req, deps)).error?.code).toBe(
      "CAPABILITY_DENIED"
    );
    expect(deps.terminal.io).not.toHaveBeenCalled();
    deps.permitted = () => true;
    expect(
      (
        await executeUiRequest(
          { ...req, params: { command: "echo test" } },
          deps
        )
      ).error?.code
    ).toBe("INVALID_PARAMS");
    expect(deps.terminal.io).not.toHaveBeenCalled();
  });
  it("reports input delivery without inventing a command exit code and preserves uncertain writes", async () => {
    const deps = dependencies();
    const req = {
      ...request(),
      command: "ui.terminal.input",
      params: { terminalId: "one", data: "yes\r" },
    };
    deps.terminal.io = vi.fn(async () => ({
      inputState: "written",
      executionState: "unconfirmed",
    }));
    const response = await executeUiRequest(req, deps);
    expect(response.result).toEqual({
      inputState: "written",
      executionState: "unconfirmed",
    });
    deps.terminal.io = vi.fn(async () => {
      throw new Error("TERMINAL_WRITE_UNKNOWN: partial write");
    });
    expect((await executeUiRequest(req, deps)).status).toBe("unknown");
  });
  it("allows bounded terminal reads while presentation is disabled", async () => {
    const deps = dependencies();
    deps.permitted = () => false;
    deps.terminal.io = vi.fn(async () => ({
      output: "retained text",
      truncated: false,
    }));
    const req = {
      ...request(),
      command: "ui.terminal.read",
      params: { terminalId: "one", maxBytes: 512 },
    };
    expect((await executeUiRequest(req, deps)).status).toBe("applied");
    expect(
      (
        await executeUiRequest(
          { ...req, params: { terminalId: "one", maxBytes: 8193 } },
          deps
        )
      ).error?.code
    ).toBe("INVALID_PARAMS");
  });
  it("checks readable file before writing the captured workspace", async () => {
    const deps = dependencies();
    const req = request();
    const result = await executeUiRequest(req, deps);
    expect(deps.openFile).toHaveBeenCalledWith("/repo/file.ts", 12, {
      kind: "session",
      sessionId: "A",
    });
    expect(result.status).toBe("applied");
    expect(result.result).toMatchObject({
      contentState: "readable",
      locationState: "pending",
      revealed: false,
    });
  });
  it("never creates a tab on missing or unreadable files", async () => {
    const deps = dependencies();
    deps.prepareFile = vi.fn(async () => {
      throw new Error("FILE_NOT_READABLE: denied");
    });
    expect((await executeUiRequest(request(), deps)).error?.code).toBe(
      "FILE_NOT_READABLE"
    );
    expect(deps.openFile).not.toHaveBeenCalled();
  });
  it("rechecks revocation after file IO and does not write", async () => {
    const deps = dependencies();
    let permitted = true;
    deps.permitted = () => permitted;
    deps.prepareFile = async () => {
      permitted = false;
      return "/repo/file.ts";
    };
    expect((await executeUiRequest(request(), deps)).error?.code).toBe(
      "CAPABILITY_DENIED"
    );
    expect(deps.openFile).not.toHaveBeenCalled();
  });
  it("rejects cancelled requests and repository changes after preparation", async () => {
    const deps = dependencies();
    let active = true;
    deps.active = async () => active;
    deps.prepareFile = async () => {
      active = false;
      return "/repo/file.ts";
    };
    expect((await executeUiRequest(request(), deps)).error?.code).toBe(
      "DEADLINE_EXCEEDED"
    );
    expect(deps.openFile).not.toHaveBeenCalled();
    const other = dependencies();
    let repo = "/repo";
    other.resolveWorkspace = () => ({ repoPath: repo });
    other.prepareFile = async () => {
      repo = "/other";
      return "/repo/file.ts";
    };
    expect((await executeUiRequest(request(), other)).error?.code).toBe(
      "TARGET_NOT_FOUND"
    );
    expect(other.openFile).not.toHaveBeenCalled();
  });
  it("permits reads while UI presentation is disabled", async () => {
    const deps = dependencies();
    deps.permitted = () => false;
    expect(
      (
        await executeUiRequest(
          { ...request(), command: "ui.context", params: {} },
          deps
        )
      ).status
    ).toBe("applied");
    expect((await executeUiRequest(request(), deps)).error?.code).toBe(
      "CAPABILITY_DENIED"
    );
  });
  it("rejects unknown params, DOM execution and credential-bearing URLs", async () => {
    const deps = dependencies();
    for (const req of [
      { ...request(), params: { path: "file", unexpected: true } },
      { ...request(), command: "gui.execute" },
      {
        ...request(),
        command: "ui.web.open",
        params: { url: "javascript:alert(1)" },
      },
      {
        ...request(),
        command: "ui.web.open",
        params: { url: "https://user:secret@example.com" },
      },
    ])
      expect((await executeUiRequest(req, deps)).status).toBe("failed");
    expect(deps.openFile).not.toHaveBeenCalled();
    expect(deps.openWeb).not.toHaveBeenCalled();
  });
  it("checks partition before focusing a shared resource", async () => {
    const deps = dependencies();
    deps.tabs = () => [tab];
    expect(
      (
        await executeUiRequest(
          {
            ...request(),
            command: "ui.tab.focus",
            params: { tabId: tab.id, partition: "shared" },
          },
          deps
        )
      ).error?.code
    ).toBe("TAB_NOT_FOUND");
    expect(deps.focus).not.toHaveBeenCalled();
  });
});
