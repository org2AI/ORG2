// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { type Mock, afterEach, beforeEach, expect, it, vi } from "vitest";

import type {
  QueryResult,
  SqliteConnectionConfig,
  TableInfo,
} from "@src/engines/DatabaseCore";

import { type UseDbPreviewReturn, useDbPreview } from "./useDbPreview";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const roots = new Set<Root>();
function renderHook<Props extends object = Record<string, never>>(
  fn: (props: Props) => UseDbPreviewReturn,
  opts?: { initialProps: Props }
) {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  roots.add(root);
  const result = { current: null as unknown as UseDbPreviewReturn };
  function Hook(p: Props) {
    result.current = fn(p);
    return null;
  }
  const render = (p: Props) =>
    act(() => root.render(React.createElement(Hook, p)));
  render(opts?.initialProps ?? ({} as Props));
  return {
    result,
    rerender: render,
    unmount() {
      act(() => root.unmount());
      roots.delete(root);
      el.remove();
    },
  };
}
function cleanup() {
  for (const root of roots) act(() => root.unmount());
  roots.clear();
  document.body.innerHTML = "";
}

interface TestProvider {
  path: string;
  disconnect: Mock<() => Promise<void>>;
  getTables: Mock<() => Promise<TableInfo[]>>;
  getTableData: Mock<() => Promise<QueryResult>>;
}
const { providers, pending } = vi.hoisted(() => ({
  providers: [] as TestProvider[],
  pending: new Map<string, { promise: Promise<void>; resolve: () => void }>(),
}));
vi.mock("@src/engines/DatabaseCore/providers/index.ts", () => ({
  SqliteProvider: class {
    path: string;
    disconnect = vi.fn(async () => {});
    constructor(c: SqliteConnectionConfig) {
      this.path = c.filePath;
      providers.push(this);
    }
    connect() {
      return pending.get(this.path)!.promise;
    }
    getTables = vi.fn<() => Promise<TableInfo[]>>(async () => [
      { name: this.path, type: "table" },
    ]);
    async getTableSchema() {
      return [];
    }
    getTableData = vi.fn<() => Promise<QueryResult>>(async () => {
      return {
        columns: ["id"],
        values: [[this.path]],
        rowCount: 1,
        totalCount: 1,
        duration: 0,
      };
    });
  },
}));
vi.mock("@src/engines/DatabaseCore/providers/isValidSqliteFile.ts", () => ({
  isValidSqliteFile: vi.fn(async () => true),
}));

const defer = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
beforeEach(() => {
  providers.length = 0;
  pending.clear();
  pending.set("A", defer());
  pending.set("B", defer());
});
afterEach(cleanup);
it("keeps B selected when A connects late, and closes both owners", async () => {
  const h = renderHook(({ path }: { path: string }) => useDbPreview(path), {
    initialProps: { path: "A" },
  });
  await flush();
  h.rerender({ path: "B" });
  await flush();
  await act(async () => {
    pending.get("B")!.resolve();
  });
  await flush();
  expect(h.result.current.selectedTable).toBe("B");
  await act(async () => {
    pending.get("A")!.resolve();
  });
  await flush();
  expect(h.result.current.selectedTable).toBe("B");
  h.unmount();
  expect(providers.find((p) => p.path === "A")!.disconnect).toHaveBeenCalled();
  expect(
    providers.find((p) => p.path === "B")!.disconnect
  ).toHaveBeenCalledTimes(1);
});
it("closes a connection that finishes after unmount", async () => {
  const h = renderHook(() => useDbPreview("A"));
  await flush();
  h.unmount();
  await act(async () => {
    pending.get("A")!.resolve();
  });
  await flush();
  expect(providers).toHaveLength(1);
  expect(providers[0].disconnect).toHaveBeenCalled();
});

it("failed initial loading releases its owner and refresh retries", async () => {
  const h = renderHook(() => useDbPreview("A"));
  await flush();
  providers[0].getTables.mockRejectedValueOnce(new Error("schema unavailable"));
  await act(async () => {
    pending.get("A")!.resolve();
  });
  await flush();
  expect(h.result.current.error).toBe("schema unavailable");
  expect(h.result.current.connecting).toBe(false);
  expect(providers[0].disconnect).toHaveBeenCalled();
  await act(async () => {
    h.result.current.refresh();
  });
  await flush();
  expect(h.result.current.error).toBeNull();
  expect(h.result.current.selectedTable).toBe("A");
});

it("a late page cannot replace a newer selection and a successful retry clears errors", async () => {
  const h = renderHook(() => useDbPreview("A"));
  await flush();
  await act(async () => {
    pending.get("A")!.resolve();
  });
  await flush();
  let finish!: (value: QueryResult) => void;
  providers[0].getTableData.mockImplementationOnce(
    () =>
      new Promise<QueryResult>((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => {
    h.result.current.loadPage(2);
  });
  await act(async () => {
    h.result.current.selectTable("new-table");
  });
  await flush();
  expect(h.result.current.selectedTable).toBe("new-table");
  await act(async () => {
    finish({
      columns: [],
      values: [],
      rowCount: 0,
      totalCount: 0,
      duration: 0,
    });
  });
  expect(h.result.current.selectedTable).toBe("new-table");
  providers[0].getTableData.mockRejectedValueOnce(
    new Error("page unavailable")
  );
  await act(async () => {
    h.result.current.loadPage(2);
  });
  await flush();
  expect(h.result.current.error).toBe("page unavailable");
  await act(async () => {
    h.result.current.loadPage(2);
  });
  await flush();
  expect(h.result.current.error).toBeNull();
  expect(h.result.current.page).toBe(2);
});

it("empty database finishes loading and remains refreshable", async () => {
  const h = renderHook(() => useDbPreview("A"));
  await flush();
  providers[0].getTables.mockResolvedValueOnce([]);
  await act(async () => {
    pending.get("A")!.resolve();
  });
  await flush();
  expect(h.result.current.connecting).toBe(false);
  expect(h.result.current.selectedTable).toBeNull();
  expect(h.result.current.error).toBeNull();
});
