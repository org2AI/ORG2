/* @vitest-environment jsdom */
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import { type UseAsyncDataReturn, useAsyncData } from "./useAsyncData";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => vi.clearAllMocks());

describe("useAsyncData", () => {
  it("lets only the latest keyed generation commit", async () => {
    const requests = new Map<string, Deferred<string>>();
    let result: UseAsyncDataReturn<string> | undefined;
    const query = vi.fn((key: string) => {
      const request = deferred<string>();
      requests.set(key, request);
      return request.promise;
    });
    const root = createSmokeRoot();

    function Probe({ queryKey }: { queryKey: string }) {
      const value = useAsyncData({
        key: queryKey,
        query,
        initialData: "initial",
      });
      React.useEffect(() => {
        result = value;
      }, [value]);
      return null;
    }

    await root.render(React.createElement(Probe, { queryKey: "old" }));
    await root.render(React.createElement(Probe, { queryKey: "new" }));
    requests.get("new")?.resolve("new result");
    await flushAsync();
    requests.get("old")?.resolve("stale result");
    await flushAsync();

    expect(result).toMatchObject({ data: "new result", loading: false });
    await root.unmount();
  });

  it("fires onSuccess and onError only for the committed generation", async () => {
    const requests = new Map<string, Deferred<string>>();
    const query = vi.fn((key: string) => {
      const request = deferred<string>();
      requests.set(key, request);
      return request.promise;
    });
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const root = createSmokeRoot();

    function Probe({ queryKey }: { queryKey: string }) {
      useAsyncData({
        key: queryKey,
        query,
        initialData: "initial",
        mapError: (error) => (error === "ignored" ? null : String(error)),
        onSuccess,
        onError,
      });
      return null;
    }

    await root.render(React.createElement(Probe, { queryKey: "stale" }));
    await root.render(React.createElement(Probe, { queryKey: "fresh" }));
    requests.get("fresh")?.resolve("fresh result");
    await flushAsync();
    requests.get("stale")?.resolve("stale result");
    await flushAsync();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("fresh result", "fresh");

    await root.render(React.createElement(Probe, { queryKey: "failing" }));
    requests.get("failing")?.reject(new Error("boom"));
    await flushAsync();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      "Error: boom",
      expect.any(Error),
      "failing"
    );

    await root.render(React.createElement(Probe, { queryKey: "suppressed" }));
    requests.get("suppressed")?.reject("ignored");
    await flushAsync();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    await root.unmount();
  });

  it("does not query while disabled", async () => {
    const query = vi.fn(async () => "result");
    let result: UseAsyncDataReturn<string> | undefined;
    const root = createSmokeRoot();

    function Probe() {
      const value = useAsyncData({
        key: "stable",
        query,
        initialData: "fallback",
        enabled: false,
      });
      React.useEffect(() => {
        result = value;
      }, [value]);
      return null;
    }

    await root.render(React.createElement(Probe));

    expect(query).not.toHaveBeenCalled();
    expect(result).toMatchObject({ data: "fallback", loading: false });
    await root.unmount();
  });
});
