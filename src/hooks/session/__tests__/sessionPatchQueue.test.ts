import { describe, expect, it, vi } from "vitest";

import type { Session } from "@src/store/session/sessionAtom/types";

import { createSessionPatchQueue } from "../sessionPatchQueue";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup() {
  let current: Session | undefined = {
    session_id: "session",
    created_at: "2026-09-23",
    updated_at: "2026-09-23",
    status: "idle",
    model: "original",
    accountId: "a",
  };
  const writes: ReturnType<typeof deferred>[] = [];
  const persist = vi.fn(() => {
    const operation = deferred();
    writes.push(operation);
    return operation.promise;
  });
  const watchers = new Set<() => void>();
  const patch = createSessionPatchQueue({
    read: () => current,
    publish: (row) => {
      current = row;
      watchers.forEach((changed) => changed());
    },
    persist,
    subscribe: (_id, changed) => {
      watchers.add(changed);
      return () => {
        watchers.delete(changed);
      };
    },
  });
  return {
    patch,
    persist,
    writes,
    watchers,
    get current() {
      return current;
    },
    set current(row) {
      current = row;
      watchers.forEach((changed) => changed());
    },
  };
}

describe("ordered session mutation boundary", () => {
  it("keeps rapid model/account picks optimistic but persists them in order", async () => {
    const state = setup();
    const first = state.patch("session", { model: "one", accountId: "b" });
    const second = state.patch("session", { model: "two", accountId: "c" });
    expect(state.current).toMatchObject({ model: "two", accountId: "c" });
    expect(state.persist).toHaveBeenCalledTimes(1);
    state.writes[0].resolve();
    await first;
    expect(state.persist).toHaveBeenNthCalledWith(2, "session", {
      model: "two",
      accountId: "c",
    });
    expect(state.current?.model).toBe("two");
    state.writes[1].resolve();
    await second;
    expect(state.current).toMatchObject({ model: "two", accountId: "c" });
  });

  it("two failures restore confirmed identity without undoing an unrelated update", async () => {
    const state = setup();
    const first = state.patch("session", { model: "one", accountId: "b" });
    const firstRejected = expect(first).rejects.toThrow("first");
    const second = state.patch("session", { model: "two", accountId: "c" });
    const secondRejected = expect(second).rejects.toThrow("second");
    state.current = { ...state.current!, name: "renamed elsewhere" };
    state.writes[0].reject(new Error("first"));
    await firstRejected;
    expect(state.current?.model).toBe("two");
    state.writes[1].reject(new Error("second"));
    await secondRejected;
    expect(state.current).toMatchObject({
      model: "original",
      accountId: "a",
      name: "renamed elsewhere",
    });
    const retry = state.patch("session", { model: "retry", accountId: "d" });
    state.writes[2].resolve();
    await retry;
    expect(state.current).toMatchObject({ model: "retry", accountId: "d" });
  });

  it("rolls a later failure back to the previous successful pair", async () => {
    const state = setup();
    const first = state.patch("session", { model: "one", accountId: "b" });
    const second = state.patch("session", { model: "two", accountId: "c" });
    const rejected = expect(second).rejects.toThrow("rejected");
    state.writes[0].resolve();
    await first;
    state.writes[1].reject(new Error("rejected"));
    await rejected;
    expect(state.current).toMatchObject({ model: "one", accountId: "b" });
  });

  it("preserves an external selection observed between two rejected local picks", async () => {
    const state = setup();
    const first = state.patch("session", { model: "one", accountId: "b" });
    const firstRejected = expect(first).rejects.toThrow("first");
    state.current = { ...state.current!, model: "external", accountId: "x" };
    const second = state.patch("session", { model: "two", accountId: "c" });
    const secondRejected = expect(second).rejects.toThrow("second");
    state.writes[0].reject(new Error("first"));
    await firstRejected;
    expect(state.current).toMatchObject({ model: "two", accountId: "c" });
    state.writes[1].reject(new Error("second"));
    await secondRejected;
    expect(state.current).toMatchObject({ model: "external", accountId: "x" });
    expect(state.watchers.size).toBe(0);
  });

  it("replays the latest pick immediately over an earlier RPC account-switch echo", async () => {
    const state = setup();
    const first = state.patch("session", { model: "one", accountId: "b" });
    const second = state.patch("session", { model: "two", accountId: "c" });
    state.current = { ...state.current!, model: "one", accountId: "b" };
    expect(state.current).toMatchObject({ model: "two", accountId: "c" });
    state.writes[0].resolve();
    await first;
    expect(state.current).toMatchObject({ model: "two", accountId: "c" });
    state.writes[1].resolve();
    await second;
    expect(state.current).toMatchObject({ model: "two", accountId: "c" });
    expect(state.watchers.size).toBe(0);
  });

  it("never splits an external model/account pair that shares a pending model", async () => {
    const state = setup();
    const pending = state.patch("session", { model: "one", accountId: "b" });
    const rejected = expect(pending).rejects.toThrow("failed");
    state.current = { ...state.current!, model: "one", accountId: "external" };
    state.writes[0].reject(new Error("failed"));
    await rejected;
    expect(state.current).toMatchObject({
      model: "one",
      accountId: "external",
    });
    expect(state.watchers.size).toBe(0);
  });

  it("keeps an external product/exec mode pair atomic on failure", async () => {
    const state = setup();
    state.current = {
      ...state.current!,
      productMode: "ask",
      agentExecMode: "ask",
    };
    const pending = state.patch("session", {
      productMode: "project",
      agentExecMode: "build",
    });
    const rejected = expect(pending).rejects.toThrow("failed");
    state.current = {
      ...state.current!,
      productMode: "build",
      agentExecMode: "build",
    };
    state.writes[0].reject(new Error("failed"));
    await rejected;
    expect(state.current).toMatchObject({
      productMode: "build",
      agentExecMode: "build",
    });
  });

  it("does not resurrect a deleted session or overwrite a newer external identity", async () => {
    const state = setup();
    const first = state.patch("session", { model: "one" });
    state.current = { ...state.current!, model: "external" };
    state.writes[0].resolve();
    await first;
    expect(state.current?.model).toBe("external");
    const second = state.patch("session", { model: "two" });
    state.current = undefined;
    state.writes[1].resolve();
    await second;
    expect(state.current).toBeUndefined();
  });

  it("preserves clear-draft semantics and avoids writes for unchanged fields", async () => {
    const state = setup();
    await state.patch("session", { model: "original" });
    expect(state.persist).not.toHaveBeenCalled();
    state.current = { ...state.current!, draftText: "draft" };
    const clear = state.patch("session", { draftText: null });
    expect(state.current?.draftText).toBeUndefined();
    expect(state.persist).toHaveBeenCalledWith("session", { draftText: null });
    state.writes[0].resolve();
    await clear;
  });

  it("bounds pending work and releases the subscription after draining", async () => {
    const state = setup();
    const pending = Array.from({ length: 64 }, (_, index) =>
      state.patch("session", { model: `model-${index}`, accountId: "a" })
    );
    await expect(state.patch("session", { model: "overflow" })).rejects.toThrow(
      "Too many pending session changes"
    );
    expect(state.current?.model).toBe("model-63");
    expect(state.watchers.size).toBe(1);
    for (let index = 0; index < pending.length; index += 1) {
      state.writes[index].resolve();
      await pending[index];
    }
    expect(state.persist).toHaveBeenCalledTimes(64);
    expect(state.watchers.size).toBe(0);
  });
});
