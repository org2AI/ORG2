// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import type { MobileConnectionState } from "../connection/types";
import { useMobileSessionModel } from "./useMobileSessionModel";

describe("useMobileSessionModel", () => {
  it("loads options only on demand, shares flights, retains config on error and rejects stale results", async () => {
    const env = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    env.IS_REACT_ACT_ENVIRONMENT = true;
    let finish!: (value: unknown) => void;
    let fail!: (error: Error) => void;
    const call = vi.fn((method: string, params: Record<string, unknown>) => {
      if (method === "session/config")
        return Promise.resolve({
          sessionId: params.sessionId,
          model: "current",
          modelEditable: true,
        });
      return new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
    });
    const client = { call } as unknown as MobileRpcClient;
    const clientRef = { current: client as MobileRpcClient | null };
    const activeSessionRef = { current: "a" as string | null };
    const connectionRef = {
      current: {
        status: "connected",
        presence: "online",
        demoMode: false,
      } as MobileConnectionState,
    };
    let model!: ReturnType<typeof useMobileSessionModel>;
    function Harness() {
      const value = useMobileSessionModel({
        clientRef,
        activeSessionRef,
        connectionRef,
        requireWritableClient: () => client,
      });
      React.useLayoutEffect(() => {
        model = value;
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(React.createElement(Harness)));
      await act(async () => model.refreshSessionModel("a"));
      expect(call.mock.calls.map(([method]) => method)).toEqual([
        "session/config",
      ]);
      let first!: Promise<void>;
      await act(async () => {
        first = model.loadSessionModels("a");
        expect(model.loadSessionModels("a")).toBe(first);
      });
      expect(model.sessionModel.optionsLoading).toBe(true);
      await act(async () => {
        fail(new Error("catalog unavailable"));
        await first;
      });
      expect(model.sessionModel.config?.model).toBe("current");
      expect(model.sessionModel.optionsError).toBe("catalog unavailable");
      await act(async () => {
        first = model.loadSessionModels("a");
      });
      await act(async () => {
        finish({ models: [] });
        await first;
      });
      expect(model.sessionModel.optionsError).toBeUndefined();
      expect(model.sessionModel.optionsLoading).toBe(false);
      const count = call.mock.calls.length;
      await act(async () => model.loadSessionModels("a"));
      expect(call).toHaveBeenCalledTimes(count);
      await act(async () => model.resetSessionModel());
      await act(async () => model.refreshSessionModel("a"));
      await act(async () => {
        first = model.loadSessionModels("a");
      });
      activeSessionRef.current = "b";
      await act(async () => {
        model.resetSessionModel();
        await model.refreshSessionModel("b");
      });
      await act(async () => {
        finish({
          models: [{ id: "stale", accountId: "a", accountLabel: "a" }],
        });
        await first;
      });
      expect(model.sessionModel.config?.sessionId).toBe("b");
      expect(model.sessionModel.options).toEqual([]);
      call.mockResolvedValueOnce({
        sessionId: "b",
        model: "readonly",
        modelEditable: false,
      });
      await act(async () => model.refreshSessionModel("b"));
      const readonlyCount = call.mock.calls.length;
      await act(async () => model.loadSessionModels("b"));
      expect(call).toHaveBeenCalledTimes(readonlyCount);
    } finally {
      await act(async () => root.unmount());
      env.IS_REACT_ACT_ENVIRONMENT = false;
    }
  });

  it("does not apply a late model patch to a newly selected session", async () => {
    const env = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    env.IS_REACT_ACT_ENVIRONMENT = true;
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const client = {
      call: vi.fn((method: string, params: Record<string, unknown>) => {
        if (method === "session/patch") return pending;
        if (method === "session/config")
          return Promise.resolve({
            sessionId: params.sessionId,
            model: "original",
            modelEditable: true,
          });
        return Promise.resolve({ models: [] });
      }),
    } as unknown as MobileRpcClient;
    const clientRef = { current: client as MobileRpcClient | null };
    const activeSessionRef = { current: "a" as string | null };
    const connectionRef = {
      current: {
        status: "connected",
        presence: "online",
        demoMode: false,
      } as MobileConnectionState,
    };
    const requireWritableClient = () => client;
    let model!: ReturnType<typeof useMobileSessionModel>;
    function Harness() {
      const value = useMobileSessionModel({
        clientRef,
        connectionRef,
        activeSessionRef,
        requireWritableClient,
      });
      React.useLayoutEffect(() => {
        model = value;
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(React.createElement(Harness)));
      await act(async () => model.refreshSessionModel("a"));
      let patch!: Promise<void>;
      await act(async () => {
        patch = model.setSessionModel("a", {
          id: "new-model",
          accountId: "account",
          accountLabel: "Account",
        });
      });
      expect(model.sessionModel.patching).toBe(true);
      activeSessionRef.current = "b";
      await act(async () => model.refreshSessionModel("b"));
      await act(async () => {
        finish();
        await patch;
      });
      expect(model.sessionModel.config).toMatchObject({
        sessionId: "b",
        model: "original",
      });
      expect(model.sessionModel.patching).toBe(false);
      await act(async () => model.resetSessionModel());
      expect(model.sessionModel.config).toBeNull();
    } finally {
      await act(async () => root.unmount());
      env.IS_REACT_ACT_ENVIRONMENT = false;
    }
  });
});
