// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import ConnectionSettings from "./ConnectionSettings";

const api = vi.hoisted(() => ({ load: vi.fn(), link: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./rpc", () => ({
  loadConnections: api.load,
  agentFor: () => "codex",
}));
vi.mock("./deepLink", () => ({ handleMarketConnectionUrl: api.link }));
vi.mock("@src/components/Select", () => ({
  default: ({
    value,
    options,
    onChange,
  }: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (v: string) => void;
  }) =>
    createElement(
      "select",
      {
        value,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
          onChange(e.target.value),
      },
      options.map((o) =>
        createElement("option", { key: o.value, value: o.value }, o.label)
      )
    ),
}));
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.clearAllMocks();
});
it("retains the selected identity on reorder and falls back to the remaining connection after deletion", async () => {
  const a = {
    identity_user_id: "11111111-1111-4111-8111-111111111111",
    workspace_id: "ws_a",
    target: "codex",
    phase: "authorization_saved",
  };
  const b = { ...a, workspace_id: "ws_b" };
  api.load.mockResolvedValue({ enabled: true, connections: [a, b] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(createElement(ConnectionSettings, { agentName: "codex" }))
  );
  const select = container.querySelector("select")!;
  await act(async () => {
    select.value = select.options[1].value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  api.load.mockResolvedValue({ enabled: true, connections: [b, a] });
  await act(async () => {
    window.dispatchEvent(new Event("market-connections-changed"));
  });
  expect(
    container.querySelector("select")!.selectedOptions[0].textContent
  ).toBe("ws_b");
  api.load.mockResolvedValue({ enabled: true, connections: [a] });
  await act(async () => {
    window.dispatchEvent(new Event("market-connections-changed"));
  });
  expect(container.querySelector("select")).toBeNull();
  const observed = vi.fn();
  window.addEventListener("market-connection-open", observed);
  try {
    await act(async () => container!.querySelector("button")!.click());
    expect(observed).toHaveBeenCalledOnce();
    expect((observed.mock.calls[0][0] as CustomEvent).detail.workspace_id).toBe(
      "ws_a"
    );
  } finally {
    window.removeEventListener("market-connection-open", observed);
  }
});
