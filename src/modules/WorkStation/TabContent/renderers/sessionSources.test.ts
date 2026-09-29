// @vitest-environment jsdom
import { Provider, atom, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionSource } from "@src/engines/ChatPanel/sessionSources/extractSessionSources";
import { useSessionSourceNavigation } from "@src/features/SessionSources/useSessionSourceNavigation";
import { createSessionSourcesTab } from "@src/store/workstation/tabs/factories/sessionSources";

import SessionSourcesTabRenderer from "./sessionSources";

const api = vi.hoisted(() => ({ readSessionSourceMessages: vi.fn() }));
const localFiles = vi.hoisted(() => ({ openFileInWorkStation: vi.fn() }));
const sharedFiles = vi.hoisted(() => ({ openSharedSessionFile: vi.fn() }));
vi.mock("@src/api/tauri/session/sessionSources", () => api);
vi.mock("@src/util/ui/openFileInWorkStation", () => localFiles);
vi.mock("@src/features/Org2Cloud/openSharedSessionFile", () => sharedFiles);

const session = atom<{
  updated_at: string;
  repoPath?: string;
  importedFrom?: {
    orgId: string;
    sourceSessionId: string;
    sourceEndpointUrl?: string;
    shareEndpointUrl?: string;
  };
}>({ updated_at: "initial" });
vi.mock("@src/store/session", () => ({
  sessionByIdAtom: () => session,
}));

// The view owns search, pagination and navigation tests. This probe verifies
// the actual renderer -> resource hook -> durable-history API boundary.
vi.mock("@src/features/SessionSources/SessionSourcesView", () => ({
  SessionSourcesView: ({
    sources,
    loading,
    error,
    onRetry,
    basePath,
  }: {
    sources: SessionSource[];
    loading: boolean;
    error: boolean;
    onRetry: () => void;
    basePath?: string;
  }) => {
    const { openSource } = useSessionSourceNavigation(sources, basePath);
    return React.createElement(
      "section",
      { "aria-busy": loading, "data-error": error },
      sources.map((source) => source.key).join(" "),
      React.createElement("button", { onClick: onRetry }, "Retry"),
      ...sources.map((source) =>
        React.createElement(
          "button",
          {
            key: source.key,
            "data-source": source.key,
            onClick: () => openSource(source),
          },
          "Open source"
        )
      )
    );
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("session sources tab renderer", () => {
  let root: Root;
  let host: HTMLDivElement;
  let store: ReturnType<typeof createStore>;

  async function render(sessionId: string, isActive = true) {
    await act(async () => {
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(SessionSourcesTabRenderer, {
            tab: createSessionSourcesTab(sessionId, "Sources"),
            isActive,
          })
        )
      );
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    api.readSessionSourceMessages.mockReset();
    localFiles.openFileInWorkStation.mockReset();
    sharedFiles.openSharedSessionFile.mockReset();
    store = createStore();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("loads only the active tab and ignores a read that resolves after hiding", async () => {
    const first = deferred<unknown>();
    api.readSessionSourceMessages.mockReturnValueOnce(first.promise);
    await render("session-a", false);
    expect(host.childElementCount).toBe(0);
    expect(api.readSessionSourceMessages).not.toHaveBeenCalled();

    await render("session-a");
    expect(api.readSessionSourceMessages).toHaveBeenCalledExactlyOnceWith(
      "session-a"
    );
    expect(host.querySelector("section")?.getAttribute("aria-busy")).toBe(
      "true"
    );
    await render("session-a", false);
    await act(async () =>
      first.resolve([{ id: "a", text: "https://a.example/late" }])
    );
    expect(host.childElementCount).toBe(0);

    api.readSessionSourceMessages.mockResolvedValueOnce([
      { id: "a", text: "https://a.example/fresh" },
    ]);
    await render("session-a");
    expect(host.textContent).toContain("https://a.example/fresh");
    expect(host.textContent).not.toContain("late");
    expect(api.readSessionSourceMessages).toHaveBeenCalledTimes(2);
  });

  it("binds to the tab's session and cannot commit a previous tab's pending read", async () => {
    const first = deferred<unknown>();
    api.readSessionSourceMessages
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce([{ id: "b", text: "https://b.example/" }]);
    await render("session-a");
    await render("session-b");
    expect(api.readSessionSourceMessages.mock.calls).toEqual([
      ["session-a"],
      ["session-b"],
    ]);
    await act(async () =>
      first.resolve([{ id: "a", text: "https://a.example/" }])
    );
    expect(host.textContent).toContain("https://b.example/");
    expect(host.textContent).not.toContain("https://a.example/");
  });

  it("forwards read failures and retries through the resource API", async () => {
    api.readSessionSourceMessages.mockRejectedValueOnce(
      new Error("read failed")
    );
    await render("retry-session");
    expect(host.querySelector("section")?.getAttribute("data-error")).toBe(
      "true"
    );
    api.readSessionSourceMessages.mockResolvedValueOnce([
      { id: "ok", text: "https://recovered.example/" },
    ]);
    await act(async () => host.querySelector("button")!.click());
    expect(host.querySelector("section")?.getAttribute("data-error")).toBe(
      "false"
    );
    expect(host.textContent).toContain("https://recovered.example/");
    expect(api.readSessionSourceMessages).toHaveBeenCalledTimes(2);
  });

  it("refreshes after session metadata changes and handles empty restored bindings", async () => {
    api.readSessionSourceMessages.mockResolvedValueOnce([
      { id: "a1", text: "https://a.example/old" },
    ]);
    await render("session-a");
    api.readSessionSourceMessages.mockResolvedValueOnce([
      { id: "a2", text: "https://a.example/new" },
    ]);
    await act(async () => store.set(session, { updated_at: "next" }));
    expect(host.textContent).toContain("https://a.example/new");
    expect(host.textContent).not.toContain("https://a.example/old");
    await render("");
    expect(host.textContent).not.toContain("https://a.example/");
    expect(api.readSessionSourceMessages).toHaveBeenCalledTimes(2);
  });

  it("routes imported file references through the sender's cloud scope instead of the receiver's disk", async () => {
    store.set(session, {
      updated_at: "shared",
      repoPath: "/sender/repo",
      importedFrom: {
        orgId: "remote-org",
        sourceSessionId: "remote-session",
        sourceEndpointUrl: "https://cloud.example",
      },
    });
    api.readSessionSourceMessages.mockResolvedValueOnce([
      {
        id: "source",
        role: "assistant",
        text: "[Report](/sender/repo/report.md)",
      },
    ]);
    await render("imported-local-id");
    expect(api.readSessionSourceMessages).toHaveBeenCalledWith(
      "imported-local-id"
    );
    const fileButton = host.querySelector<HTMLButtonElement>("[data-source]");
    expect(fileButton).not.toBeNull();
    await act(async () => fileButton!.click());
    expect(localFiles.openFileInWorkStation).not.toHaveBeenCalled();
    expect(sharedFiles.openSharedSessionFile).toHaveBeenCalledExactlyOnceWith(
      {
        id: "source",
        endpoint: "https://cloud.example",
        source: {
          orgId: "remote-org",
          sessionId: "remote-session",
          path: "/sender/repo/report.md",
        },
      },
      null
    );

    // An updated import scope must replace the previous sender without ever
    // interpreting its absolute path as a receiver-local file.
    await act(async () =>
      store.set(session, {
        updated_at: "shared",
        repoPath: "/sender/repo",
        importedFrom: {
          orgId: "next-org",
          sourceSessionId: "next-session",
          sourceEndpointUrl: "https://next-cloud.example",
        },
      })
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>("[data-source]")!.click()
    );
    expect(sharedFiles.openSharedSessionFile).toHaveBeenCalledTimes(2);
    expect(sharedFiles.openSharedSessionFile).toHaveBeenLastCalledWith(
      {
        id: "source",
        endpoint: "https://next-cloud.example",
        source: {
          orgId: "next-org",
          sessionId: "next-session",
          path: "/sender/repo/report.md",
        },
      },
      null
    );
    expect(localFiles.openFileInWorkStation).not.toHaveBeenCalled();
  });

  it("uses the local session's repository for relative file navigation", async () => {
    store.set(session, { updated_at: "local", repoPath: "/local/project" });
    api.readSessionSourceMessages.mockResolvedValueOnce([
      { id: "source", text: "[report](./src/report.md)" },
    ]);
    await render("local-session");
    const fileButton = host.querySelector<HTMLButtonElement>("[data-source]");
    expect(fileButton).not.toBeNull();
    await act(async () => fileButton!.click());
    expect(localFiles.openFileInWorkStation).toHaveBeenCalledExactlyOnceWith(
      "/local/project/src/report.md",
      { defaultPreviewMode: true }
    );
    expect(sharedFiles.openSharedSessionFile).not.toHaveBeenCalled();
  });

  it("opens assistant and tool files alongside attachments from the same history read", async () => {
    store.set(session, { updated_at: "mixed", repoPath: "/local/project" });
    api.readSessionSourceMessages.mockResolvedValueOnce([
      { id: "user", text: "", images: ["/local/reference.png"] },
      {
        id: "assistant",
        role: "assistant",
        text: "[Report](./docs/report.md)\n[Fix PR](https://github.com/example/project/pull/1)",
      },
      {
        id: "tool",
        role: "tool",
        toolName: "read_file",
        text: "[file:src/main.ts]",
      },
    ]);
    await render("mixed-session");
    expect(host.querySelectorAll("[data-source]")).toHaveLength(4);
    expect(host.textContent).toContain(
      "https://github.com/example/project/pull/1"
    );
    for (const key of ["file:./docs/report.md", "file:src/main.ts"]) {
      const button = Array.from(
        host.querySelectorAll<HTMLButtonElement>("[data-source]")
      ).find((element) => element.dataset.source === key);
      expect(button).toBeDefined();
      await act(async () => button!.click());
    }
    expect(localFiles.openFileInWorkStation.mock.calls).toEqual([
      ["/local/project/docs/report.md", { defaultPreviewMode: true }],
      ["/local/project/src/main.ts", { defaultPreviewMode: true }],
    ]);
  });
});
