// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { restoreToInputAtom } from "@src/store/session/cliSessionStatusAtom";
import { type SmokeRoot, createSmokeRoot } from "@src/test/reactSmokeHarness";

import { RejectedRequestRecoveryAction } from "./RejectedRequestRecoveryAction";

const mocks = vi.hoisted(() => ({
  draftText: "",
  getDraft: vi.fn(),
  messageError: vi.fn(),
}));

vi.mock("@src/api/tauri/agent", () => ({
  getAgentOrgRejectedRequestDraft: mocks.getDraft,
}));

vi.mock("@src/store/session", async () => {
  const { atom } = await import("jotai/vanilla");
  return {
    sessionByIdAtom: () => atom({ draftText: mocks.draftText }),
  };
});

vi.mock("@src/components/Message", () => ({
  default: { error: mocks.messageError },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@src/scaffold/ModalSystem", () => ({
  default: ({
    visible,
    children,
    footer,
  }: {
    visible: boolean;
    children: React.ReactNode;
    footer: React.ReactNode;
  }) =>
    visible
      ? createElement(
          "div",
          { "data-testid": "recovery-preview" },
          children,
          footer
        )
      : null,
}));

describe("RejectedRequestRecoveryAction", () => {
  let root: SmokeRoot;
  let store: ReturnType<typeof createStore>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.draftText = "";
    mocks.getDraft.mockResolvedValue({
      sessionId: "coordinator-session",
      turnIntentId: "turn-rejected",
      displayContent: "create the follow-up task",
      imageDataUrls: ["data:image/png;base64,recovered"],
    });
    root = createSmokeRoot();
    store = createStore();
    await root.render(
      createElement(
        Provider,
        { store },
        createElement(RejectedRequestRecoveryAction, {
          sessionId: "coordinator-session",
          turnIntentId: "turn-rejected",
        })
      )
    );
  });

  afterEach(async () => {
    window.localStorage.clear();
    await root.unmount();
  });

  async function click(testId: string): Promise<void> {
    await act(async () => {
      root.container
        .querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!
        .click();
      await Promise.resolve();
    });
  }

  it("restores the exact persisted request without sending it", async () => {
    await click("agent-org-rejected-request-restore-button");

    await vi.waitFor(() =>
      expect(store.get(restoreToInputAtom)).toEqual({
        sessionId: "coordinator-session",
        displayContent: "create the follow-up task",
        imageDataUrls: ["data:image/png;base64,recovered"],
        appendImages: true,
      })
    );
    expect(mocks.getDraft).toHaveBeenCalledWith({
      sessionId: "coordinator-session",
      turnIntentId: "turn-rejected",
    });
  });

  it("requires an explicit append when a newer draft already exists", async () => {
    mocks.draftText = "new text the user is still editing";
    await click("agent-org-rejected-request-restore-button");

    await vi.waitFor(() =>
      expect(
        root.container.querySelector('[data-testid="recovery-preview"]')
      ).not.toBeNull()
    );
    expect(store.get(restoreToInputAtom)).toBeNull();

    await click("agent-org-rejected-request-append-button");
    expect(store.get(restoreToInputAtom)?.displayContent).toBe(
      "create the follow-up task"
    );
    expect(store.get(restoreToInputAtom)?.appendImages).toBe(true);
  });

  it("requires an explicit append for an image-only newer draft", async () => {
    window.localStorage.setItem(
      "orgii:chat-image-draft:coordinator-session",
      JSON.stringify([
        {
          id: "current-image",
          dataUrl: "data:image/png;base64,current",
          fileName: "current.png",
          size: 7,
          width: 1,
          height: 1,
        },
      ])
    );

    await click("agent-org-rejected-request-restore-button");

    await vi.waitFor(() =>
      expect(
        root.container.querySelector('[data-testid="recovery-preview"]')
      ).not.toBeNull()
    );
    expect(store.get(restoreToInputAtom)).toBeNull();
  });
});
