// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { invokeTauri } from "@src/util/platform/tauri/init";

import ActiveProcesses from "./ActiveProcesses";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/util/platform/tauri/init", () => ({ invokeTauri: vi.fn() }));
vi.mock(
  "@src/services/terminal",
  () => import("@src/services/terminal/agentShellProcess")
);

afterEach(() => {
  vi.clearAllMocks();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

it("clicking a process Stop sends its complete registration through the real service", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(invokeTauri).mockResolvedValue("Stopped");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        createElement(ActiveProcesses, {
          onToggle: () => {},
          sessionId: "worker-session",
          initialProcesses: [
            {
              pid: 42,
              handle: "shell-registration",
              callId: "server-call",
              command: "serve project",
              status: "background",
              startedAt: 0,
            },
          ],
        })
      );
    });
    const stop = container.querySelector<HTMLButtonElement>(
      'button[title="actions.stop"]'
    );
    expect(stop).not.toBeNull();
    await act(async () => stop!.click());
    expect(invokeTauri).toHaveBeenCalledExactlyOnceWith(
      "agent_kill_shell_process",
      {
        pid: 42,
        handle: "shell-registration",
        sessionId: "worker-session",
        callId: "server-call",
      }
    );
    // Request acknowledgement alone must not invent a process-exit event.
    expect(container.textContent).toContain("serve project");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
