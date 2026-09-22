// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PermissionSheetRequest } from "@src/components/PermissionPrompt";

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import { useMobilePermissions } from "./useMobilePermissions";

const request = (
  requestId: string,
  sessionId = "session-a"
): PermissionSheetRequest => ({
  requestId,
  sessionId,
  origin: "rust_agent",
  toolName: "shell",
  toolArgs: { command: "pwd" },
});

describe("useMobilePermissions inbox navigation", () => {
  let root: ReturnType<typeof createRoot>;
  let current: ReturnType<typeof useMobilePermissions>;
  let sessionId: string | null;
  let call: ReturnType<typeof vi.fn>;
  let requireWritableClient: () => MobileRpcClient;
  let renderedErrors: { requestId: string | undefined; failed: boolean }[];
  function Harness() {
    const value = useMobilePermissions({
      sessionId,
      demoMode: false,
      requireWritableClient,
    });
    renderedErrors.push({
      requestId: value.activePermission?.requestId,
      failed: value.permissionFailed,
    });
    React.useLayoutEffect(() => {
      current = value;
    });
    return null;
  }
  const render = () =>
    act(async () => root.render(React.createElement(Harness)));
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot(document.createElement("div"));
    sessionId = null;
    renderedErrors = [];
    call = vi.fn().mockResolvedValue({});
    const client = { call } as unknown as MobileRpcClient;
    requireWritableClient = () => client;
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("selects the clicked pending request instead of the first request in that session", async () => {
    await render();
    await act(async () => {
      current.reconcilePermissions([request("first"), request("clicked")]);
      current.focusPermission("clicked");
    });
    sessionId = "session-a";
    await render();
    expect(current.activePermission?.requestId).toBe("clicked");
    await act(async () => current.respondPermission("allow"));
    expect(call).toHaveBeenCalledWith("interaction/respond_permission", {
      sessionId: "session-a",
      requestId: "clicked",
      response: "allow",
      origin: "rust_agent",
    });
    expect(current.activePermission?.requestId).toBe("first");
  });

  it("never selects a preferred request from another session", async () => {
    sessionId = "session-b";
    await render();
    await act(async () => {
      current.reconcilePermissions([
        request("clicked"),
        request("other", "session-b"),
      ]);
      current.focusPermission("clicked");
    });
    expect(current.activePermission?.requestId).toBe("other");
    await act(async () => current.reconcilePermissions([]));
    expect(current.activePermission).toBeNull();
    await act(async () => current.respondPermission("allow"));
    expect(call).not.toHaveBeenCalled();
  });

  it("session refresh does not delete unrelated pending requests", async () => {
    sessionId = "session-b";
    await render();
    await act(async () =>
      current.reconcilePermissions([
        request("one"),
        request("two", "session-b"),
      ])
    );
    await act(async () => current.reconcileSessionPermissions("session-a", []));
    expect(current.activePermission?.requestId).toBe("two");
    expect(current.permissionQueueDepth).toBe(1);
  });
  it("keeps failed requests with safe feedback and clears feedback when retry succeeds", async () => {
    sessionId = "session-a";
    await render();
    await act(async () =>
      current.reconcilePermissions([request("one"), request("two")])
    );
    call.mockRejectedValueOnce(new Error("private-token"));
    await act(async () => current.respondPermission("allow"));
    expect(current.activePermission?.requestId).toBe("one");
    expect(current.permissionFailed).toBe(true);
    expect(current.permissionSubmitting).toBe(false);
    await act(async () => current.respondPermission("deny"));
    expect(current.activePermission?.requestId).toBe("two");
    expect(current.permissionFailed).toBe(false);
  });
  it("clears failures when the request is resolved, dismissed, or reset", async () => {
    sessionId = "session-a";
    await render();
    for (const clear of [
      () => current.reconcileSessionPermissions("session-a", []),
      () => current.dismissPermissionHead(),
      () => current.resetPermissions(),
    ]) {
      await act(async () => current.reconcilePermissions([request("one")]));
      call.mockRejectedValueOnce(new Error("offline"));
      await act(async () => current.respondPermission("allow"));
      expect(current.permissionFailed).toBe(true);
      await act(async () => clear());
      expect(current.permissionFailed).toBe(false);
      expect(current.activePermission).toBeNull();
    }
  });
  it("ignores a late failure after switching request and preserves the next submission lock", async () => {
    sessionId = "session-a";
    await render();
    await act(async () =>
      current.reconcilePermissions([request("one"), request("two")])
    );
    let rejectFirst!: (error: Error) => void;
    let resolveNext!: (value: unknown) => void;
    call.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFirst = reject;
        })
    );
    let first!: Promise<void>;
    await act(async () => {
      first = current.respondPermission("allow");
    });
    await act(async () => current.focusPermission("two"));
    call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNext = resolve;
        })
    );
    let next!: Promise<void>;
    await act(async () => {
      next = current.respondPermission("deny");
    });
    await act(async () => {
      rejectFirst(new Error("old failure"));
      await first;
    });
    expect(current.permissionFailed).toBe(false);
    expect(current.permissionSubmitting).toBe(true);
    expect(current.activePermission?.requestId).toBe("two");
    await act(async () => {
      resolveNext({});
      await next;
    });
    expect(current.activePermission?.requestId).toBe("one");
  });
  it("does not carry failure feedback across session changes", async () => {
    sessionId = "session-a";
    await render();
    await act(async () =>
      current.reconcilePermissions([
        request("one"),
        request("two", "session-b"),
      ])
    );
    call.mockRejectedValueOnce(new Error("offline"));
    await act(async () => current.respondPermission("allow"));
    sessionId = "session-b";
    renderedErrors = [];
    await render();
    expect(current.permissionFailed).toBe(false);
    expect(current.activePermission?.requestId).toBe("two");
    expect(
      renderedErrors
        .filter((value) => value.requestId === "two")
        .every((value) => !value.failed)
    ).toBe(true);
  });
});
