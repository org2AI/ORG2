// @vitest-environment jsdom
import { createElement } from "react";
import { expect, it, vi } from "vitest";

import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import { useTraySessions } from "./index";

vi.mock("@src/util/platform/tauri", () => ({ isTauriDesktop: () => false }));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ error: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/store/session", () => ({
  sessionsAtom: {},
  visitedSessionsAtom: {},
}));
vi.mock("@src/store/chatPanel/chatPanelTabsAtom", () => ({
  openOrFocusSessionInChatPanelTabAtom: {},
}));
vi.mock("@src/store/ui/chatPanel/visibilityAtoms", () => ({
  activeStationChatVisibleAtom: {},
}));
vi.mock("@src/store/ui/simulatorAtom", () => ({ stationModeAtom: {} }));

it("renders in the bootstrap tree without Router context", async () => {
  function BootstrapTray() {
    useTraySessions();
    return createElement("span", null, "ready");
  }
  const root = createSmokeRoot();
  try {
    await root.render(createElement(BootstrapTray));
    expect(root.container.textContent).toBe("ready");
  } finally {
    await root.unmount();
  }
});
