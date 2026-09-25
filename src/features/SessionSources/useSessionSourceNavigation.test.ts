// @vitest-environment jsdom
import React, { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractSessionSources } from "@src/engines/ChatPanel/sessionSources/extractSessionSources";
import type { SessionSource } from "@src/engines/ChatPanel/sessionSources/extractSessionSources";

import { useSessionSourceNavigation } from "./useSessionSourceNavigation";

const mocks = vi.hoisted(() => ({
  file: vi.fn(),
  shared: vi.fn(() => false),
  error: vi.fn(),
  browser: vi.fn(),
  reveal: vi.fn(),
  set: vi.fn(),
  get: vi.fn(() => "workspace-a"),
}));
vi.mock("@src/util/ui/openFileInWorkStation", () => ({
  openFileInWorkStation: mocks.file,
}));
vi.mock("@src/util/ui/openLink", () => ({ openInBrowserApp: mocks.browser }));
vi.mock("@src/util/ui/revealMyStation", () => ({
  revealMyStation: mocks.reveal,
}));
vi.mock("@src/util/core/state/instrumentedStore", () => ({
  getInstrumentedStore: () => ({ set: mocks.set, get: mocks.get }),
}));
vi.mock("@src/store/workstation/tabs", () => ({
  createDirectoryTab: (path: string) => ({ type: "directory", path }),
  openWorkstationTabAtom: "open",
  presentedWorkstationWorkspaceKeyAtom: "workspace",
}));
vi.mock("@src/features/Org2Cloud/SharedSessionFilesContext", () => ({
  useOpenSessionSharedFile: () => mocks.shared,
}));
vi.mock("@src/components/Message", () => ({ default: { error: mocks.error } }));
let root: Root;
let host: HTMLDivElement;
let navigation: ReturnType<typeof useSessionSourceNavigation>;
function Harness({
  sources,
  basePath,
}: {
  sources: SessionSource[];
  basePath?: string;
}) {
  const current = useSessionSourceNavigation(sources, basePath);
  useEffect(() => {
    navigation = current;
  }, [current]);
  return null;
}
async function render(
  sources: SessionSource[],
  key = "session-a",
  basePath?: string
) {
  await act(async () => {
    root.render(React.createElement(Harness, { sources, key, basePath }));
  });
}
beforeEach(() => {
  host = document.createElement("div");
  root = createRoot(host);
  vi.clearAllMocks();
  mocks.shared.mockReturnValue(false);
});
afterEach(() => {
  act(() => root.unmount());
});
describe("source navigation", () => {
  it("routes files, folders and links to existing workstation entry points", async () => {
    await render([]);
    navigation.openSource({
      kind: "file",
      key: "f",
      path: "/tmp/report.md",
      fileName: "report.md",
      isDirectory: false,
    });
    expect(mocks.file).toHaveBeenCalledWith("/tmp/report.md", {
      defaultPreviewMode: true,
    });
    navigation.openSource({
      kind: "file",
      key: "d",
      path: "/tmp/docs",
      fileName: "docs",
      isDirectory: true,
    });
    expect(mocks.set).toHaveBeenCalledWith("open", {
      workspace: "workspace-a",
      tab: { type: "directory", path: "/tmp/docs" },
    });
    navigation.openSource({
      kind: "link",
      key: "l",
      url: "https://example.com",
      label: "Example",
    });
    expect(mocks.browser).toHaveBeenCalledWith("https://example.com");
  });
  it("resolves relative paths in the originating session and rejects unknown roots", async () => {
    const source: SessionSource = {
      kind: "file",
      key: "r",
      path: "./docs/guide.md",
      fileName: "guide.md",
      isDirectory: false,
    };
    await render([], "session-a", "/work/origin");
    navigation.openSource(source);
    expect(mocks.file).toHaveBeenCalledWith("/work/origin/docs/guide.md", {
      defaultPreviewMode: true,
    });
    mocks.file.mockClear();
    await render([], "session-b");
    navigation.openSource(source);
    expect(mocks.file).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledOnce();
  });
  it("lets the cloud source provider intercept before any local file access", async () => {
    mocks.shared.mockReturnValue(true);
    await render([]);
    navigation.openSource({
      kind: "file",
      key: "remote",
      path: "/owner/private.md",
      fileName: "private.md",
      isDirectory: false,
    });
    expect(mocks.shared).toHaveBeenCalledWith("/owner/private.md");
    expect(mocks.file).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("opens an MCP file URI from the actual tool DTO as a decoded local path", async () => {
    const sources = extractSessionSources([
      {
        id: "mcp",
        role: "tool",
        toolName: "resource",
        text: "report.md [file:file:///tmp/report.md]\nMy%20Report.md [file:file:///tmp/My%20Report.md]",
      },
    ]);
    expect(sources).toHaveLength(2);
    await render(sources);
    navigation.openSource(sources[0]);
    expect(mocks.file).toHaveBeenNthCalledWith(1, "/tmp/report.md", {
      defaultPreviewMode: true,
    });
    navigation.openSource(sources[1]);
    expect(mocks.file).toHaveBeenNthCalledWith(2, "/tmp/My Report.md", {
      defaultPreviewMode: true,
    });
  });
  it("keeps a gallery snapshot through refresh and resets on session remount", async () => {
    const image: SessionSource = {
      kind: "image",
      key: "i",
      ref: "/tmp/image.png",
      fileName: "image.png",
    };
    await render([image]);
    act(() => navigation.openSource(image));
    expect(navigation.imagePreview?.images).toHaveLength(1);
    await render([]);
    expect(navigation.imagePreview?.images).toHaveLength(1);
    await render([], "session-b");
    expect(navigation.imagePreview).toBeNull();
  });
});
