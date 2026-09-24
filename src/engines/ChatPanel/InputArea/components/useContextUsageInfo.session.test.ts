// @vitest-environment jsdom
import { Provider, atom, createStore } from "jotai";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useContextUsageInfo } from "./useContextUsageInfo";

const fixture = vi.hoisted(() => ({ sessionId: "native-session" }));
const sessionAtom = atom({ model: "session-model", accountId: "session-key" });
const usageAtom = atom<{ maxTokens: number; usedTokens: number } | null>(null);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/engines/SessionCore/hooks/session", () => ({
  useSessionId: () => ({ sessionId: fixture.sessionId }),
}));
vi.mock("@src/store/session", () => ({ sessionByIdAtom: () => sessionAtom }));
vi.mock("@src/api/tauri/externalHistory", () => ({
  getImportedHistorySourceBySessionId: () => null,
}));
vi.mock("@src/util/session/sessionDispatch", () => ({
  isCliSession: () => false,
}));
vi.mock("@src/hooks/models/useValidatedLastPair", () => ({
  useValidatedLastPair: () => ({
    model: "creator-model",
    selectedAccountId: "creator-key",
  }),
}));
vi.mock("@src/hooks/keyVault", () => ({
  useKeyVault: () => ({
    accounts: [
      {
        id: "session-key",
        modelVariants: [
          {
            model: "session-model",
            base_model: "session-model",
            context_window: 64_000,
          },
        ],
      },
      {
        id: "creator-key",
        modelVariants: [
          {
            model: "creator-model",
            base_model: "creator-model",
            context_window: 1_000_000,
          },
        ],
      },
    ],
  }),
}));
vi.mock("@src/store/session/cliSessionStatusAtom", async () => {
  const { atom: makeAtom } = await import("jotai");
  return {
    sessionContextTokensAtom: makeAtom(1000),
    // Factories avoid reading the test binding before module evaluation.
    sessionContextUsageAtom: makeAtom((get) => get(usageAtom)),
  };
});

it("uses the active session account until runtime telemetry supplies its actual window", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const store = createStore();
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe() {
    return createElement("span", null, useContextUsageInfo().maxTokens);
  }
  try {
    await act(async () =>
      root.render(createElement(Provider, { store }, createElement(Probe)))
    );
    expect(container.textContent).toBe("64000");
    await act(async () =>
      store.set(usageAtom, { maxTokens: 128_000, usedTokens: 1000 })
    );
    expect(container.textContent).toBe("128000");
    await act(async () => store.set(usageAtom, null));
    expect(container.textContent).toBe("64000");
  } finally {
    await act(async () => root.unmount());
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
