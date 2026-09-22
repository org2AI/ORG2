// @vitest-environment jsdom
import { createElement } from "react";
import { expect, it, vi } from "vitest";

import {
  editorRedo,
  editorUndo,
} from "@src/modules/WorkStation/actions/editorActions.zod";
import { ACTION_ID } from "@src/scaffold/ActionSystem";
import { zodActionRegistry } from "@src/scaffold/ActionSystem/schema/zodRegistry";
import {
  createSmokeRoot,
  dispatch as update,
} from "@src/test/reactSmokeHarness";

import { useCommandMode } from "../useCommandMode";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key.endsWith("undo") ? "Undo" : "Redo"),
  }),
}));
it("shows registered supported commands, filters them, dispatches once, and observes registration changes", async () => {
  const dispatch = vi.fn().mockResolvedValue({ success: true });
  const onClose = vi.fn();
  function View({ query = "", enabled = true }) {
    const { items } = useCommandMode({
      enabled,
      searchTerm: query,
      dispatch,
      onClose,
    });
    return createElement(
      "div",
      null,
      items.map((item) =>
        createElement(
          "button",
          { key: item.id, onClick: item.action },
          item.label
        )
      )
    );
  }
  const root = createSmokeRoot();
  try {
    await root.render(createElement(View));
    expect(root.container.textContent).toBe("");
    await update(() => zodActionRegistry.registerAll([editorUndo, editorRedo]));
    expect(root.container.textContent).toBe("UndoRedo");
    await root.render(createElement(View, { query: "undo" }));
    expect(root.container.textContent).toBe("Undo");
    await update(() => root.container.querySelector("button")!.click());
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(
      ACTION_ID.EDITOR_UNDO,
      {},
      "user"
    );
    expect(onClose).toHaveBeenCalledOnce();
    await update(() => zodActionRegistry.unregister(ACTION_ID.EDITOR_UNDO));
    expect(root.container.textContent).toBe("");
    await root.render(createElement(View, { enabled: false }));
    expect(root.container.textContent).toBe("");
  } finally {
    await root.unmount();
    zodActionRegistry.unregisterAll([
      ACTION_ID.EDITOR_UNDO,
      ACTION_ID.EDITOR_REDO,
    ]);
  }
});
