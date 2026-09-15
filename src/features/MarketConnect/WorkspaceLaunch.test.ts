// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import WorkspaceLaunch from "./WorkspaceLaunch";

const api = vi.hoisted(() => ({
  open: vi.fn(),
  prepare: vi.fn(),
  release: vi.fn(),
  create: vi.fn(),
  destroy: vi.fn(),
  tab: vi.fn(),
  navigate: vi.fn(),
  surface: vi.fn(),
  close: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: api.open }));
vi.mock("./launch", async (load) => ({
  ...(await load<typeof import("./launch")>()),
  prepareLaunch: api.prepare,
}));
let root: Root, host: HTMLDivElement;
const connection = {
  identity_user_id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "ws_one",
  target: "codex" as const,
};
beforeEach(async () => {
  vi.resetAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  api.open.mockResolvedValue("/chosen folder");
  api.prepare.mockResolvedValue(undefined);
  await act(async () =>
    root.render(
      createElement(WorkspaceLaunch, {
        connection,
        selection: "market:selected",
        model: "gpt-5.3-codex",
        onClose: api.close,
      })
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("opens the independent client without creating an ORG2 terminal", async () => {
  await act(async () => host.querySelector("button")!.click());
  expect(api.open).toHaveBeenCalledWith({ directory: true, multiple: false });
  expect(api.prepare).toHaveBeenCalledWith(
    connection,
    "market:selected",
    "gpt-5.3-codex",
    "/chosen folder",
    expect.any(Function)
  );
  expect(api.create).not.toHaveBeenCalled();
  expect(api.close).toHaveBeenCalledOnce();
  expect(api.navigate).not.toHaveBeenCalled();
});
it("canceling folder selection does not prepare or launch a client", async () => {
  api.open.mockResolvedValue(null);
  await act(async () => host.querySelector("button")!.click());
  expect(api.prepare).not.toHaveBeenCalled();
  expect(api.tab).not.toHaveBeenCalled();
});
it("shows a recoverable error without opening a terminal when preparation fails", async () => {
  api.prepare.mockRejectedValue(new Error("native failure"));
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("marketConnection.launchFailed");
  expect(api.create).not.toHaveBeenCalled();
  expect(api.close).not.toHaveBeenCalled();
});
