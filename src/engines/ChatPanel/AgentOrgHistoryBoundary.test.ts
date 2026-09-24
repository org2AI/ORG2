// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAgentOrgHistoryDescriptor,
  getAgentOrgHistoryPage,
} from "@src/api/tauri/agent/orgTasks/history";
import type { AgentOrgHistoryDescriptor } from "@src/api/tauri/agent/orgTasks/history";
import { useTestTranslation } from "@src/test/i18nTestTranslate";

import AgentOrgHistoryBoundary from "./AgentOrgHistoryBoundary";

vi.mock("@src/api/tauri/agent/orgTasks/history", () => ({
  getAgentOrgHistoryDescriptor: vi.fn(),
  getAgentOrgHistoryPage: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: (...args: Parameters<typeof useTestTranslation>) =>
    useTestTranslation(...args),
}));
vi.mock("@src/components/MarkDown", () => ({
  default: ({ textContent }: { textContent: string }) =>
    createElement("div", null, textContent),
}));
vi.mock("./InputArea/components/SessionReadOnlyBar", () => ({
  default: ({ label }: { label: string }) =>
    createElement("div", { "data-read-only": true }, label),
}));

const history: AgentOrgHistoryDescriptor = {
  mode: "history_only",
  rootSessionId: "sdeagent-root",
  title: "Old team",
  members: [
    { sessionId: "sdeagent-root", memberId: null, name: "Team" },
    { sessionId: "sdeagent-member", memberId: "alice", name: "Alice" },
  ],
};
const descriptor = vi.mocked(getAgentOrgHistoryDescriptor);
const page = vi.mocked(getAgentOrgHistoryPage);
const environment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("AgentOrgHistoryBoundary", () => {
  let container: HTMLDivElement;
  let root: Root;
  const renderTranscript = vi.fn((sessionId: string, readOnly: boolean) =>
    createElement("div", {
      "data-transcript": sessionId,
      "data-readonly": String(readOnly),
    })
  );
  beforeEach(() => {
    vi.clearAllMocks();
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    descriptor.mockResolvedValue(history);
    page.mockResolvedValue({ items: [], nextCursor: null });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(environment, "IS_REACT_ACT_ENVIRONMENT");
  });
  async function open(sessionId = "sdeagent-root") {
    await act(async () => {
      root.render(
        createElement(AgentOrgHistoryBoundary, {
          sessionId,
          renderTranscript,
        })
      );
    });
  }
  async function click(text: string) {
    const target = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(text)
    );
    expect(target, `button ${text}`).toBeDefined();
    await act(async () => target?.click());
  }
  it("resolves persisted identity before mounting any writable transcript", async () => {
    let resolve!: (value: AgentOrgHistoryDescriptor | null) => void;
    descriptor.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    await open();
    expect(renderTranscript).not.toHaveBeenCalled();
    await act(async () => resolve(history));
    expect(renderTranscript).toHaveBeenLastCalledWith("sdeagent-root", true);
    expect(container.textContent).toContain(
      "Older-version conversation, view only"
    );
    await click("Alice");
    expect(renderTranscript).toHaveBeenLastCalledWith("sdeagent-member", true);
    expect(descriptor).toHaveBeenCalledOnce();
  });
  it("keeps ordinary sessions writable", async () => {
    descriptor.mockResolvedValue(null);
    await open("sdeagent-ordinary");
    expect(renderTranscript).toHaveBeenLastCalledWith(
      "sdeagent-ordinary",
      false
    );
    expect(container.querySelector("[data-read-only]")).toBeNull();
  });
  it("ignores a late identity result after switching sessions", async () => {
    let resolve!: (value: AgentOrgHistoryDescriptor | null) => void;
    descriptor
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      )
      .mockResolvedValue(null);
    await open();
    await open("sdeagent-ordinary");
    await act(async () => resolve(history));
    expect(renderTranscript).toHaveBeenLastCalledWith(
      "sdeagent-ordinary",
      false
    );
  });
  it("loads saved content only when opened and retains a bounded page", async () => {
    page
      .mockResolvedValueOnce({
        items: [
          {
            id: "one",
            sourceSessionId: null,
            kind: "output",
            content: "First saved output",
            createdAt: "2026-09-24",
          },
        ],
        nextCursor: "next",
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: "two",
            sourceSessionId: null,
            kind: "output",
            content: "Second saved output",
            createdAt: "2026-09-25",
          },
        ],
        nextCursor: null,
      });
    await open();
    expect(page).not.toHaveBeenCalled();
    await click("Saved group messages");
    expect(container.textContent).toContain("First saved output");
    await click("Next page");
    expect(page).toHaveBeenLastCalledWith("sdeagent-root", "next");
    expect(container.textContent).toContain("Second saved output");
    expect(container.textContent).not.toContain("First saved output");
  });
  it("fails closed on lookup failure and retries only on user action", async () => {
    descriptor
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(history);
    await open();
    expect(renderTranscript).not.toHaveBeenCalled();
    expect(descriptor).toHaveBeenCalledOnce();
    await click("Retry");
    expect(renderTranscript).toHaveBeenLastCalledWith("sdeagent-root", true);
  });
});
