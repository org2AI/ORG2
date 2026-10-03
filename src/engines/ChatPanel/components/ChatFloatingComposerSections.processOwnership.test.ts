// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { shellProcessMapAtom } from "@src/store/session/shellProcessAtom";
import { invokeTauri } from "@src/util/platform/tauri/init";

import { ComposerActivityTrackers } from "./ChatFloatingComposerSections";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/util/platform/tauri/init", () => ({ invokeTauri: vi.fn() }));
vi.mock(
  "@src/services/terminal",
  () => import("@src/services/terminal/agentShellProcess")
);
vi.mock("../InputArea/AskQuestionCard", () => ({ default: () => null }));
vi.mock("../InputArea/ModeSwitchCard", () => ({
  ModeSwitchInputCard: () => null,
}));
vi.mock("../InputArea/PermissionCard", () => ({ default: () => null }));
vi.mock("../InputArea/components/AgentOrgInterventionPinBar", () => ({
  default: () => null,
}));
vi.mock("../InputArea/components/CompactFileChanges", () => ({
  default: () => null,
}));
vi.mock("../blocks/CreatePlanCard", () => ({ default: () => null }));

afterEach(() => {
  vi.clearAllMocks();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

it.each(["member", "team-root"])(
  "tracks and stops the visible %s composer process",
  async (target) => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(invokeTauri).mockResolvedValue("Stopped");
    const store = createStore();
    store.set(
      shellProcessMapAtom,
      new Map(
        ["team-root", "member"].map((session, index) => [
          session,
          new Map([
            [
              100 + index,
              {
                pid: 100 + index,
                callId: `${session}-call`,
                handle: `${session}-registration`,
                command: `${session} server`,
                status: "background" as const,
                startedAt: 0,
              },
            ],
          ]),
        ])
      )
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const counts = vi.fn();
    const props = {
      sessionId: "team-root",
      inputAreaSessionId: target,
      processExpanded: false,
      onToggleProcess: vi.fn(),
      onProcessVisibleCountChange: counts,
      trackFileChanges: false,
      filesReloadKey: "",
      onFileChangeStatsChange: vi.fn(),
    };
    try {
      await act(async () =>
        root.render(
          createElement(
            Provider,
            { store },
            createElement(ComposerActivityTrackers, props)
          )
        )
      );
      expect(counts).toHaveBeenLastCalledWith(1);
      await act(async () =>
        root.render(
          createElement(
            Provider,
            { store },
            createElement(ComposerActivityTrackers, {
              ...props,
              processExpanded: true,
            })
          )
        )
      );
      expect(container.textContent).toContain(`${target} server`);
      expect(container.textContent).not.toContain(
        `${target === "member" ? "team-root" : "member"} server`
      );
      const stop = container.querySelector<HTMLButtonElement>(
        'button[title="actions.stop"]'
      );
      expect(stop).not.toBeNull();
      await act(async () => stop!.click());
      expect(invokeTauri).toHaveBeenCalledExactlyOnceWith(
        "agent_kill_shell_process",
        {
          pid: target === "member" ? 101 : 100,
          sessionId: target,
          callId: `${target}-call`,
          handle: `${target}-registration`,
        }
      );
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  }
);
