// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type SmokeRoot, createSmokeRoot } from "@src/test/reactSmokeHarness";

import SharedSessionFileViewer from "./SharedSessionFileViewer";
import { org2CloudAuthAtom } from "./org2CloudAuthAtom";
import type { SharedSessionFileReference } from "./sharedSessionFileReference";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  find: vi.fn(),
  token: vi.fn(),
  save: vi.fn(),
  write: vi.fn(),
  exists: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
}));
vi.mock("./config", () => ({
  getCloudEndpoint: () => ({
    supabaseUrl: "https://cloud.example",
    anonKey: "anon",
  }),
}));
vi.mock("./sharedSessionFilesClient", () => ({
  readSharedSessionFile: mocks.read,
  findSharedSessionFile: mocks.find,
}));
vi.mock("./org2CloudSessionCommentsAtom.freshToken", () => ({
  useCloudFreshAccessToken: () => mocks.token,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeFile: mocks.write,
  exists: mocks.exists,
  BaseDirectory: { Download: 6 },
}));
vi.mock("@src/components/Message", () => ({
  default: { success: mocks.success, error: mocks.failure },
}));
vi.mock("@src/scaffold/ModalSystem", () => ({
  default: ({ children }: { children: unknown }) => children,
}));
const reference = {
  id: "11111111-1111-4111-8111-111111111111",
  endpoint: "https://cloud.example",
};
const auth = {
  kind: "org2_cloud" as const,
  supabaseUrl: reference.endpoint,
  supabaseAnonKey: "anon",
  userId: "user-1",
  accessToken: "token",
  refreshToken: "refresh",
  expiresAt: 9999999999,
};
const file = {
  id: reference.id,
  name: "report.md",
  size: 5,
  sha256: "0".repeat(64),
  bytes: new TextEncoder().encode("hello"),
};
describe("shared file viewer lifecycle", () => {
  let root: SmokeRoot;
  let store: ReturnType<typeof createStore>;
  beforeEach(() => {
    vi.resetAllMocks();
    root = createSmokeRoot();
    store = createStore();
    store.set(org2CloudAuthAtom, auth);
    mocks.token.mockResolvedValue("token");
  });
  afterEach(async () => {
    await root.unmount();
  });
  async function render(ref: SharedSessionFileReference = reference) {
    await root.render(
      createElement(
        Provider,
        { store },
        createElement(SharedSessionFileViewer, {
          reference: ref,
          onClose: vi.fn(),
        })
      )
    );
    await act(async () => {});
  }
  it("loads only on mount and displays safe text", async () => {
    mocks.read.mockResolvedValue({
      ...file,
      bytes: new TextEncoder().encode("<script>bad()</script>"),
    });
    await render();
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(document.querySelector("pre")?.textContent).toBe(
      "<script>bad()</script>"
    );
    expect(document.querySelector("script")).toBeNull();
  });
  it("downloads without a save dialog and keeps the preview visible", async () => {
    mocks.read.mockResolvedValue(file);
    await render();
    await act(async () => {
      (
        document.querySelector(
          '[data-testid="shared-file-download"]'
        ) as HTMLButtonElement
      ).click();
    });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.write).toHaveBeenCalledWith("report.md", file.bytes, {
      baseDir: 6,
      createNew: true,
    });
    expect(mocks.success).toHaveBeenCalled();
    expect(document.querySelector("pre")?.textContent).toBe("hello");
  });
  it("keeps the preview visible when saving fails", async () => {
    mocks.read.mockResolvedValue(file);
    mocks.write.mockRejectedValue(new Error("disk full"));
    mocks.exists.mockResolvedValue(false);
    await render();
    await act(async () => {
      (
        document.querySelector(
          '[data-testid="shared-file-download"]'
        ) as HTMLButtonElement
      ).click();
    });
    expect(mocks.failure).toHaveBeenCalled();
    expect(document.querySelector("pre")?.textContent).toBe("hello");
  });
  it("resolves sender paths through the cloud index before reading bytes", async () => {
    mocks.find.mockResolvedValue(file);
    mocks.read.mockResolvedValue(file);
    await render({
      ...reference,
      id: "source",
      source: { orgId: "org", sessionId: "session", path: "/sender/report.md" },
    });
    expect(mocks.find).toHaveBeenCalledWith(
      "token",
      expect.any(Object),
      "org",
      "session",
      "/sender/report.md",
      undefined,
      expect.any(AbortSignal)
    );
    expect(mocks.read).toHaveBeenCalledWith(
      "token",
      expect.any(Object),
      file.id,
      expect.any(AbortSignal)
    );
    expect(document.querySelector("pre")?.textContent).toBe("hello");
  });
  it("does not fall back to local disk when the sender has not uploaded a file", async () => {
    mocks.find.mockResolvedValue(null);
    await render({
      ...reference,
      id: "source",
      source: {
        orgId: "org",
        sessionId: "session",
        path: "/sender/missing.md",
      },
    });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  });
  it("aborts a pending source lookup on close", async () => {
    mocks.find.mockImplementation(() => new Promise(() => {}));
    await render({
      ...reference,
      id: "source",
      source: { orgId: "org", sessionId: "session", path: "/sender/report.md" },
    });
    const signal = mocks.find.mock.calls[0][6] as AbortSignal;
    await root.unmount();
    expect(signal.aborted).toBe(true);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("rejects a different backend without sending credentials", async () => {
    await render({ ...reference, endpoint: "https://other.example" });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  });
  it("aborts pending work when closed", async () => {
    mocks.read.mockImplementation(() => new Promise(() => {}));
    await render();
    const signal = mocks.read.mock.calls[0][3] as AbortSignal;
    expect(signal.aborted).toBe(false);
    await root.unmount();
    expect(signal.aborted).toBe(true);
  });
  it("does not publish the previous account's delayed result", async () => {
    let resolve!: (value: typeof file) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    await render();
    await act(async () => {
      store.set(org2CloudAuthAtom, null);
      resolve(file);
    });
    expect(document.querySelector("pre")).toBeNull();
    expect(document.body.textContent).not.toContain("hello");
  });
});
