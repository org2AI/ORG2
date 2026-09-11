// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SideChatSessionBody } from ".";

const fixture = vi.hoisted(() => ({
  binding: {
    root: {
      authority: "local-session",
      authorityScope: [],
      conversationId: "root-session",
    },
    target: {
      cliAgentType: "codex",
      accountId: "root-account",
      model: "gpt-root",
    },
  },
  bindingProviderValue: undefined as unknown,
  chatHistoryProps: undefined as Record<string, unknown> | undefined,
  directSubmit: vi.fn(),
  inputAreaProps: undefined as Record<string, unknown> | undefined,
  routerOptions: undefined as Record<string, unknown> | undefined,
  routerSubmit: vi.fn(),
  routerRetry: vi.fn(),
  routerResolve: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/contexts/workspace/ChatContext", () => ({
  ChatProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../ConversationExecutionBindingContext", () => ({
  ConversationExecutionBindingContext: {
    Provider: ({
      value,
      children,
    }: {
      value: unknown;
      children: React.ReactNode;
    }) => {
      fixture.bindingProviderValue = value;
      return children;
    },
  },
}));
vi.mock("../ChatHistory", () => ({
  default: (props: Record<string, unknown>) => {
    fixture.chatHistoryProps = props;
    return null;
  },
}));
vi.mock("../InputArea", () => ({
  default: (props: Record<string, unknown>) => {
    fixture.inputAreaProps = props;
    return null;
  },
}));
vi.mock("../hooks/useConversationTargetBinding", () => ({
  useConversationTargetBinding: () => fixture.binding,
}));
vi.mock("../hooks/useWorkspaceChat/useUserIntentSubmit", () => ({
  useUserIntentSubmit: () => fixture.directSubmit,
}));
vi.mock("../hooks/conversationSubmit/useConversationSubmitRouter", () => ({
  useConversationSubmitRouter: (options: Record<string, unknown>) => {
    fixture.routerOptions = options;
    return {
      submit: fixture.routerSubmit,
      retry: fixture.routerRetry,
      resolveDispatch: fixture.routerResolve,
    };
  },
}));

describe("SideChatSessionBody direct Member ownership", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    fixture.bindingProviderValue = undefined;
    fixture.chatHistoryProps = undefined;
    fixture.inputAreaProps = undefined;
    fixture.routerOptions = undefined;
    fixture.directSubmit.mockReset().mockResolvedValue(undefined);
    fixture.routerSubmit.mockReset();
    fixture.routerRetry.mockReset();
    fixture.routerResolve.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(
          Provider,
          { store: createStore() },
          React.createElement(SideChatSessionBody, {
            sessionId: "member-session",
            isLive: false,
            session: {
              session_id: "member-session",
              parentSessionId: "root-session",
              orgMemberId: "implementer",
            } as never,
          })
        )
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("ignores a discoverable Root binding and keeps all sends on the Member", async () => {
    expect(fixture.routerOptions).toMatchObject({
      sessionId: "member-session",
      isDirectAgentOrgMember: true,
      root: fixture.binding.root,
      selectedTarget: fixture.binding.target,
    });
    expect(fixture.bindingProviderValue).toBeNull();
    expect(fixture.inputAreaProps).toMatchObject({
      sessionId: "member-session",
      showAgentControls: true,
      onSubmitOverride: fixture.routerSubmit,
    });
    expect(fixture.chatHistoryProps).toMatchObject({
      onFailedUserIntentRetry: fixture.routerRetry,
      resolveFailedUserIntentDispatch: fixture.routerResolve,
    });

    const onSurfaceSubmit = fixture.routerOptions?.onSurfaceSubmit as (
      input: Record<string, unknown>
    ) => Promise<boolean>;
    await expect(
      onSurfaceSubmit({
        displayText: "side quest",
        agentContent: "side quest",
        imageDataUrls: ["data:image/png;base64,side"],
      })
    ).resolves.toBe(true);
    expect(fixture.directSubmit).toHaveBeenCalledWith({
      sessionId: "member-session",
      displayContent: "side quest",
      agentContent: "side quest",
      imageDataUrls: ["data:image/png;base64,side"],
      source: "dispatch",
    });
  });
});
