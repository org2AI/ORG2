// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import AgentErrorChatItem from "@src/engines/ChatPanel/ChatItems/AgentErrorChatItem";

const mocks = vi.hoisted(() => ({
  source: undefined as string | undefined,
  link: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("jotai", () => ({
  useAtomValue: (atom: string) =>
    atom === "id" ? "session" : { credentialSource: mocks.source },
}));
vi.mock("@src/engines/SessionCore/core/atoms", () => ({ sessionIdAtom: "id" }));
vi.mock("@src/store/session", () => ({ sessionByIdAtom: () => "session" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/session", search: "", hash: "" }),
}));
vi.mock("@src/hooks/navigation/useAppNavigate", () => ({
  useAppNavigate: () => mocks.navigate,
}));
vi.mock("./deepLink", () => ({ handleMarketConnectionUrl: mocks.link }));
let root: Root | undefined;
let container: HTMLDivElement;
const connection = {
  identity_user_id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "ws_saved",
  target: "codex",
};
const source =
  "market:" +
  btoa(JSON.stringify({ metadata: connection, entitlement_id: "purchase" }))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
async function render(errorMessage: string) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(createElement(AgentErrorChatItem, { errorMessage }))
  );
}
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  mocks.source = undefined;
  vi.clearAllMocks();
});
it("reauthorizes the saved Market workspace, never an error-supplied destination or ordinary account", async () => {
  mocks.source = source;
  await render(
    "HTTP 412: credential_store_read_failed https://untrusted.invalid"
  );
  expect(container.textContent).toContain(
    "integrations:marketConnection.failed"
  );
  expect(container.textContent).not.toContain("untrusted.invalid");
  const button = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === "integrations:marketConnection.reauthorize"
  )!;
  await act(async () => button.click());
  expect(mocks.link).toHaveBeenCalledWith(
    "orgii://market/connect?workspace_id=ws_saved&target=codex"
  );
  expect(mocks.navigate).not.toHaveBeenCalled();
});
it("offers connection management for transient errors without starting authorization", async () => {
  mocks.source = source;
  const observed = vi.fn();
  window.addEventListener("market-connection-open", observed);
  try {
    await render("HTTP 429 Too Many Requests");
    const button = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "integrations:marketConnection.manage"
    )!;
    await act(async () => button.click());
    expect(observed.mock.calls[0][0].detail).toEqual(connection);
    expect(mocks.link).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("market-connection-open", observed);
  }
});
it("does not infer a Market connection from an error alone", async () => {
  await render("credential_store_read_failed");
  expect(container.textContent).not.toContain(
    "integrations:marketConnection.reauthorize"
  );
  expect(mocks.link).not.toHaveBeenCalled();
});

it("does not fall back to an ordinary account when a durable source is malformed", async () => {
  mocks.source = "market:malformed";
  await render("codex invalid_grant");
  expect(container.textContent).not.toContain("errors.reconnectCodex");
  expect(container.textContent).not.toContain(
    "integrations:marketConnection.reauthorize"
  );
  expect(mocks.navigate).not.toHaveBeenCalled();
});
