// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { ConversationRootLocator } from "@src/engines/SessionCore/conversations/conversationTypes";

import { SubmitValidationError } from "../useInputArea/types";
import {
  buildCanonicalConversationDispatch,
  canonicalConversationTargetOrThrow,
  useConversationSubmitRouter,
} from "./useConversationSubmitRouter";

const mocks = vi.hoisted(() => ({
  downloadProgress: null as unknown,
  submitUserIntent: vi.fn(),
}));

vi.mock(
  "@src/engines/ChatPanel/hooks/useWorkspaceChat/useUserIntentSubmit",
  () => ({ useUserIntentSubmit: () => mocks.submitUserIntent })
);

vi.mock("@src/features/Org2Cloud/useCloudSessionDownloadSurface", () => ({
  useCloudSessionDownloadProgressEntry: () => mocks.downloadProgress,
}));

const root: ConversationRootLocator = {
  authority: "imported-history",
  authorityScope: ["codex_app"],
  conversationId: "codexapp-session-1",
};

const selectedTarget = {
  cliAgentType: "codex" as const,
  accountId: "openai-1",
  model: "gpt-5.6-sol",
};

type ConversationSubmitRouter = ReturnType<typeof useConversationSubmitRouter>;

interface RouterHarnessProps {
  sessionId: string;
  isDirectAgentOrgMember: boolean;
  onSurfaceSubmit: () => Promise<boolean>;
  selectedTarget: typeof selectedTarget | null;
  onReady: (router: ConversationSubmitRouter) => void;
}

function RouterHarness({
  sessionId,
  isDirectAgentOrgMember,
  onSurfaceSubmit,
  selectedTarget: runtimeTarget,
  onReady,
}: RouterHarnessProps): null {
  const router = useConversationSubmitRouter({
    sessionId,
    isDirectAgentOrgMember,
    currentSession: undefined,
    root,
    selectedTarget: runtimeTarget,
    onSurfaceSubmit,
  });
  useEffect(() => onReady(router), [onReady, router]);
  return null;
}

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function renderRouter(params: {
  sessionId?: string;
  isDirectAgentOrgMember?: boolean;
  onSurfaceSubmit?: () => Promise<boolean>;
  selectedTarget?: typeof selectedTarget | null;
}) {
  let router: ConversationSubmitRouter | undefined;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const reactRoot = createRoot(container);
  mountedRoots.push({ container, root: reactRoot });
  act(() => {
    reactRoot.render(
      createElement(
        Provider,
        { store: createStore() },
        createElement(RouterHarness, {
          sessionId: params.sessionId ?? "root-session",
          isDirectAgentOrgMember: params.isDirectAgentOrgMember ?? false,
          selectedTarget:
            params.selectedTarget === undefined
              ? selectedTarget
              : params.selectedTarget,
          onSurfaceSubmit:
            params.onSurfaceSubmit ?? vi.fn().mockResolvedValue(false),
          onReady: (value) => {
            router = value;
          },
        })
      )
    );
  });

  if (!router) throw new Error("conversation submit router was not captured");
  return router;
}

describe("useConversationSubmitRouter", () => {
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    mocks.downloadProgress = null;
    mocks.submitUserIntent.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    for (const mounted of mountedRoots.splice(0)) {
      act(() => mounted.root.unmount());
      mounted.container.remove();
    }
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("leaves a Member composer submission to its direct dispatcher", async () => {
    const router = renderRouter({ isDirectAgentOrgMember: true });

    await expect(
      router.submit({ displayText: "direct work", agentContent: "direct work" })
    ).resolves.toBe(false);
    expect(mocks.submitUserIntent).not.toHaveBeenCalled();
  });

  it("leaves a Member failed retry to its direct dispatcher", async () => {
    const router = renderRouter({ isDirectAgentOrgMember: true });

    await expect(
      router.retry({
        displayText: "retry direct work",
        agentContent: "retry direct work",
        turnIntentId: "member-retry-intent",
      })
    ).resolves.toBe(false);
    expect(mocks.submitUserIntent).not.toHaveBeenCalled();
  });

  it("keeps direct ownership when a Member is the outer Session", async () => {
    const router = renderRouter({
      sessionId: "member-session",
      isDirectAgentOrgMember: true,
    });

    await expect(
      router.submit({ displayText: "member tab", agentContent: "member tab" })
    ).resolves.toBe(false);
    await expect(
      router.retry({
        displayText: "member retry",
        agentContent: "member retry",
      })
    ).resolves.toBe(false);
    expect(mocks.submitUserIntent).not.toHaveBeenCalled();
    expect(router.resolveDispatch()).toEqual({ action: "clear" });
  });

  it("keeps an ordinary Root continuation canonical", async () => {
    const router = renderRouter({});

    await expect(
      router.submit({ displayText: "continue", agentContent: "continue" })
    ).resolves.toBe(true);
    expect(mocks.submitUserIntent).toHaveBeenCalledOnce();
    expect(mocks.submitUserIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "root-session",
        conversationDispatch: expect.objectContaining({
          kind: "canonical_conversation",
          root,
          target: selectedTarget,
        }),
      })
    );
    expect(router.resolveDispatch()).toEqual({
      action: "replace",
      dispatch: expect.objectContaining({
        kind: "canonical_conversation",
        root,
        target: selectedTarget,
      }),
    });
  });

  it("keeps surface routing first and never submits a second time", async () => {
    const onSurfaceSubmit = vi.fn().mockResolvedValue(true);
    const router = renderRouter({
      isDirectAgentOrgMember: true,
      onSurfaceSubmit,
    });
    const input = { displayText: "group delivery", agentContent: "delivery" };

    await expect(router.submit(input)).resolves.toBe(true);
    expect(onSurfaceSubmit).toHaveBeenCalledWith(input);
    expect(mocks.submitUserIntent).not.toHaveBeenCalled();
  });

  it("preserves the canonical missing-runtime validation", async () => {
    const router = renderRouter({ selectedTarget: null });

    await expect(
      router.submit({ displayText: "continue", agentContent: "continue" })
    ).rejects.toThrow(SubmitValidationError);
    expect(mocks.submitUserIntent).not.toHaveBeenCalled();
  });

  it("preserves an existing failed-row dispatch while runtime selection is unavailable", () => {
    const router = renderRouter({ selectedTarget: null });

    expect(router.resolveDispatch()).toEqual({ action: "preserve" });
  });
});

describe("canonicalConversationTargetOrThrow", () => {
  it("allows an ordinary session to use its existing direct dispatcher", () => {
    expect(canonicalConversationTargetOrThrow(null, null)).toBeNull();
  });

  it("never routes a canonical source through the legacy direct dispatcher", () => {
    expect(() => canonicalConversationTargetOrThrow(root, null)).toThrow(
      SubmitValidationError
    );
  });

  it("returns the selected canonical runtime", () => {
    const target = {
      cliAgentType: "codex",
      accountId: "openai",
      model: "gpt-test",
      workspaceRepoPath: "/repo",
    } as const;
    expect(canonicalConversationTargetOrThrow(root, target)).toBe(target);
  });
});

describe("buildCanonicalConversationDispatch", () => {
  const target = selectedTarget;

  it("carries the current root and runtime for a local canonical retry", () => {
    expect(
      buildCanonicalConversationDispatch({
        root: {
          authority: "local-session",
          authorityScope: [],
          conversationId: "s-1",
        },
        selectedTarget: target,
        auth: null,
      })
    ).toEqual({
      kind: "canonical_conversation",
      root: {
        authority: "local-session",
        authorityScope: [],
        conversationId: "s-1",
      },
      target,
    });
  });

  it("binds a Cloud retry to the signed-in identity and returns null without it", () => {
    const cloudRoot: ConversationRootLocator = {
      authority: "org2-cloud",
      authorityScope: ["https://cloud.example", "org-1"],
      conversationId: "s-1",
    };
    expect(
      buildCanonicalConversationDispatch({
        root: cloudRoot,
        selectedTarget: target,
        auth: null,
      })
    ).toBeNull();
    expect(
      buildCanonicalConversationDispatch({
        root: cloudRoot,
        selectedTarget: target,
        auth: {
          kind: "org2_cloud",
          supabaseUrl: "https://cloud.example",
          supabaseAnonKey: "anon",
          userId: "user-1",
          accessToken: "token",
          refreshToken: "refresh",
          expiresAt: 0,
        } as never,
      })?.dispatchIdentityKey
    ).toBe("https://cloud.example|user-1");
  });

  it("returns null while no canonical runtime is selected", () => {
    expect(
      buildCanonicalConversationDispatch({
        root: {
          authority: "local-session",
          authorityScope: [],
          conversationId: "s-1",
        },
        selectedTarget: null,
        auth: null,
      })
    ).toBeNull();
    expect(
      buildCanonicalConversationDispatch({
        root: null,
        selectedTarget: target,
        auth: null,
      })
    ).toBeNull();
  });
});
