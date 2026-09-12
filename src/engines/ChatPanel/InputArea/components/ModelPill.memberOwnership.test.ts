// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { modelSelectorAtom } from "@src/store/ui/modelSelectorAtom";

import ModelPill from "./ModelPill";

const fixture = vi.hoisted(() => ({
  rootApplyModelPick: vi.fn(),
  setMemberModel: vi.fn(),
  memberSession: {
    session_id: "member-session",
    parentSessionId: "root-session",
    orgMemberId: "implementer",
    keySource: "own_key",
    cliAgentType: "codex",
    category: "cli_agent",
    model: "gpt-member-b",
    accountId: "member-account",
    status: "completed",
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/engines/ChatPanel/ConversationExecutionBindingContext", () => ({
  // The composer ownership resolver removes the outer Root binding before
  // ModelPill renders for a direct Member.
  useConversationExecutionBinding: () => null,
}));
vi.mock("@src/engines/SessionCore/hooks/session", () => ({
  useSessionId: () => ({ sessionId: "member-session" }),
}));
vi.mock("@src/hooks/models/useValidatedLastPair", () => ({
  useValidatedLastPair: () => null,
}));
vi.mock("@src/hooks/session/useSessionPatch", () => ({
  useSessionModelField: () => ({ setModel: fixture.setMemberModel }),
}));
vi.mock("@src/store/session", async () => {
  const { atom } = await import("jotai");
  const memberSessionAtom = atom(fixture.memberSession);
  return { sessionByIdAtom: () => memberSessionAtom };
});
vi.mock("@src/store/session/cliSessionStatusAtom", async () => {
  const { atom } = await import("jotai");
  return { sessionRuntimeStatusAtom: atom("idle") };
});
vi.mock("@src/store/session/creatorDefaultModelAtom", async () => {
  const { atom } = await import("jotai");
  return {
    creatorDefaultModelSelectionAtom: atom(null),
    extractModelPair: (config: Record<string, unknown>) => config,
  };
});
vi.mock("@src/store/ui/chatPanel/displayPrefsAtoms", async () => {
  const { atom } = await import("jotai");
  return { modelPickerStyleAtom: atom("spotlight") };
});
vi.mock("@src/components/AnyIcon", () => ({ default: () => null }));
vi.mock("@src/components/ModelIcon", () => ({ default: () => null }));
vi.mock("@src/components/Message", () => ({
  Message: { info: vi.fn(), warning: vi.fn() },
}));
vi.mock("@src/components/SelectorPill", () => ({ default: () => null }));
vi.mock("@src/components/ModelSelectorPill", async () => {
  const { createElement, forwardRef } = await import("react");
  return {
    default: forwardRef<
      HTMLButtonElement,
      { onClick: () => void; dataTestId: string }
    >(({ onClick, dataTestId }, ref) =>
      createElement("button", {
        ref,
        "data-testid": dataTestId,
        onClick,
      })
    ),
  };
});
vi.mock(
  "@src/scaffold/GlobalSpotlight/palettes/DispatchCategoryPalette/DispatchCategoryPicker",
  () => ({ DispatchCategoryPicker: () => null })
);
vi.mock(
  "@src/scaffold/GlobalSpotlight/palettes/UnifiedModelPalette",
  async () => {
    const ReactModule = await import("react");
    return {
      UnifiedModelPalette: ({
        isOpen,
        onConfigChange,
      }: {
        isOpen: boolean;
        onConfigChange: (config: Record<string, unknown>) => void;
      }) =>
        isOpen
          ? ReactModule.createElement("button", {
              "data-testid": "member-model-c",
              onClick: () =>
                onConfigChange({
                  keySource: "own_key",
                  cliAgentType: "codex",
                  model: "gpt-member-c",
                  selectedAccountId: "member-account-c",
                }),
            })
          : null,
    };
  }
);
vi.mock(
  "@src/scaffold/GlobalSpotlight/palettes/UnifiedModelPalette/UnifiedModelDropdown",
  () => ({ UnifiedModelDropdown: () => null })
);

describe("ModelPill direct Member ownership", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    fixture.rootApplyModelPick.mockReset();
    fixture.setMemberModel.mockReset().mockResolvedValue(undefined);
    store = createStore();
    store.set(modelSelectorAtom, { isOpen: false });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        React.createElement(Provider, { store }, React.createElement(ModelPill))
      )
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("shows and updates the Member model without calling the Root binding", () => {
    expect(
      container
        .querySelector('[data-testid="chat-model-target"]')
        ?.getAttribute("data-model-id")
    ).toBe("gpt-member-b");
    expect(
      container.querySelector('[data-testid="chat-runtime-pill"]')
    ).toBeNull();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="chat-model-pill-model"]'
        )
        ?.click();
    });
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="member-model-c"]')
        ?.click();
    });

    expect(fixture.setMemberModel).toHaveBeenCalledWith(
      "gpt-member-c",
      "member-account-c"
    );
    expect(fixture.rootApplyModelPick).not.toHaveBeenCalled();
  });
});
