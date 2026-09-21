// @vitest-environment jsdom
import React, { act, useLayoutEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useConnectionFormState } from "./useConnectionFormState";

const { create, services, readTables } = vi.hoisted(() => ({
  create: vi.fn(),
  services: new Map<string, { disconnect: ReturnType<typeof vi.fn> }>(),
  readTables: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@src/engines/DatabaseCore", () => ({
  isValidSqliteFile: vi.fn(async () => true),
  DatabaseServiceFactory: {
    create,
    get: (id: string) => services.get(id),
    remove: (id: string) => {
      services.delete(id);
    },
  },
}));
let root: Root | undefined;
let state: ReturnType<typeof useConnectionFormState>;
function mount() {
  const element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  function View() {
    const value = useConnectionFormState();
    useLayoutEffect(() => {
      state = value;
    });
    return React.createElement("span", null, value.testStatus);
  }
  act(() => root!.render(React.createElement(View)));
}
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  services.clear();
  create.mockReset();
  readTables.mockReset().mockResolvedValue([]);
  create.mockImplementation(async (config: { id: string }) => {
    const service = {
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      getTables: readTables,
    };
    services.set(config.id, service);
    return service;
  });
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
});
it("a schema failure closes/removes the temporary service, and retry succeeds", async () => {
  mount();
  act(() => state.setFilePath("/tmp/fake.db"));
  readTables.mockRejectedValueOnce(new Error("schema failed"));
  await act(async () => {
    await state.handleTest();
  });
  const first = await create.mock.results[0].value;
  expect(first.disconnect).toHaveBeenCalled();
  expect(services.size).toBe(0);
  expect(state.testStatus).toBe("error");
  expect(state.testError).toBe("schema failed");
  await act(async () => {
    await state.handleTest();
  });
  expect(state.testStatus).toBe("success");
  expect(state.testError).toBeNull();
  expect(services.size).toBe(0);
});
it("changing fields cancels an old probe and its late result cannot report success", async () => {
  mount();
  act(() => state.setFilePath("/tmp/old.db"));
  let finish!: (value: unknown[]) => void;
  readTables.mockImplementationOnce(
    () =>
      new Promise<unknown[]>((resolve) => {
        finish = resolve;
      })
  );
  let testing!: Promise<void>;
  await act(async () => {
    testing = state.handleTest();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  expect(state.testStatus).toBe("testing");
  act(() => state.setFilePath("/tmp/new.db"));
  expect(state.testStatus).toBe("idle");
  await act(async () => {
    finish([]);
    await testing;
  });
  expect(state.testStatus).toBe("idle");
  expect(services.size).toBe(0);
  const old = await create.mock.results[0].value;
  expect(old.disconnect).toHaveBeenCalled();
});
