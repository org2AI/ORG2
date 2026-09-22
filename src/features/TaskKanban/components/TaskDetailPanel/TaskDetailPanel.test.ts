// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KanbanTask } from "@src/features/KanbanBoard/types";
import {
  type ChatHistoryDisplayMode,
  chatHistoryDisplayModeAtom,
  chatTurnPaginationEnabledAtom,
} from "@src/store/ui/chatPanel/displayPrefsAtoms";

import TaskDetailPanel from ".";

const fixture = vi.hoisted(() => ({
  sessionContentProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/engines/ChatPanel/SessionContentView", () => ({
  default: (props: Record<string, unknown>) => {
    fixture.sessionContentProps = props;
    return null;
  },
}));
vi.mock("@src/engines/SessionCore/services/SessionService", () => ({
  SessionService: { merge: vi.fn(), worktreeDiscard: vi.fn() },
}));
vi.mock("./TaskDetailHeader", () => ({ default: () => null }));
vi.mock("./TaskDetailHeaderActions", () => ({ default: () => null }));
vi.mock("./TaskDetailViewPill", () => ({ default: () => null }));
vi.mock("./TouchedFilesList", () => ({ default: () => null }));

const task = {
  id: "task-1",
  title: "Task",
  session_id: "task-session",
} as unknown as KanbanTask;

describe("TaskDetailPanel chat display preferences", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    fixture.sessionContentProps = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.removeItem("orgii:chatHistoryDisplayMode");
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it.each<ChatHistoryDisplayMode>(["compact", "full"])(
    "passes the user's %s history display mode to the session ChatView",
    (mode) => {
      const store = createStore();
      store.set(chatHistoryDisplayModeAtom, mode);
      act(() => {
        root.render(
          React.createElement(
            Provider,
            { store },
            React.createElement(TaskDetailPanel, {
              visible: true,
              task,
              onClose: vi.fn(),
            })
          )
        );
      });

      expect(fixture.sessionContentProps).toMatchObject({
        sessionId: "task-session",
        secondary: true,
        displayMode: mode,
        turnPaginationEnabled: store.get(chatTurnPaginationEnabledAtom),
      });
    }
  );
});
