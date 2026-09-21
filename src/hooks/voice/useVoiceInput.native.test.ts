// @vitest-environment jsdom
import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import { type UseVoiceInputResult, useVoiceInput } from "./useVoiceInput";

const native = vi.hoisted(() => ({
  callback: undefined as
    | ((event: {
        sessionId: string;
        kind: string;
        transcript?: string;
      }) => void)
    | undefined,
  cancel: vi.fn().mockResolvedValue(undefined),
  querySupport: vi.fn().mockResolvedValue(true),
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  unregister: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./nativeSpeech", () => ({
  isNativeIosSpeechRuntime: () => true,
  queryNativeSpeechSupport: native.querySupport,
  listenToNativeSpeech: vi.fn((callback: typeof native.callback) => {
    native.callback = callback;
    return Promise.resolve({ unregister: native.unregister });
  }),
  startNativeSpeech: native.start,
  stopNativeSpeech: native.stop,
  cancelNativeSpeech: native.cancel,
}));

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useVoiceInput native iOS speech", () => {
  beforeEach(() => {
    native.callback = undefined;
    native.cancel.mockClear();
    native.querySupport.mockClear();
    native.querySupport.mockResolvedValue(true);
    native.start.mockClear();
    native.start.mockResolvedValue(undefined);
    native.stop.mockClear();
    native.stop.mockResolvedValue(undefined);
    native.cancel.mockResolvedValue(undefined);
    native.unregister.mockClear();
    native.unregister.mockResolvedValue(undefined);
  });

  it("streams native partial text and commits the stopped session", async () => {
    let voice: UseVoiceInputResult | undefined;
    const onCommit = vi.fn();
    const root = createSmokeRoot();

    function Probe() {
      const value = useVoiceInput({ lang: "zh-CN", onCommit });
      React.useEffect(() => {
        voice = value;
      }, [value]);
      return null;
    }

    await root.render(React.createElement(Probe));
    act(() => voice?.start());
    await flushAsync();

    expect(native.start).toHaveBeenCalledOnce();
    const sessionId = native.start.mock.calls[0]?.[1] as string;
    act(() => native.callback?.({ sessionId, kind: "started" }));
    act(() =>
      native.callback?.({
        sessionId,
        kind: "partial",
        transcript: "手机语音正常",
      })
    );

    expect(voice?.isRecording).toBe(true);
    expect(voice?.liveTranscript).toBe("手机语音正常");
    act(() => voice?.stop());
    expect(native.stop).toHaveBeenCalledWith(sessionId);
    act(() =>
      native.callback?.({
        sessionId,
        kind: "ended",
        transcript: "手机语音正常",
      })
    );

    expect(onCommit).toHaveBeenCalledWith("手机语音正常");
    expect(voice?.isRecording).toBe(false);
    await root.unmount();
    expect(native.unregister).toHaveBeenCalledOnce();
  });

  it("discards callbacks from a cancelled native session", async () => {
    let voice: UseVoiceInputResult | undefined;
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const root = createSmokeRoot();

    function Probe() {
      const value = useVoiceInput({ onCommit, onCancel });
      React.useEffect(() => {
        voice = value;
      }, [value]);
      return null;
    }

    await root.render(React.createElement(Probe));
    act(() => voice?.start());
    await flushAsync();
    const sessionId = native.start.mock.calls[0]?.[1] as string;
    act(() => native.callback?.({ sessionId, kind: "started" }));
    act(() => voice?.cancel());
    act(() =>
      native.callback?.({ sessionId, kind: "ended", transcript: "stale" })
    );

    expect(native.cancel).toHaveBeenCalledWith(sessionId);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    await root.unmount();
  });
  it("handles native cleanup rejection and ignores late transcripts after unmount", async () => {
    let voice: UseVoiceInputResult | undefined;
    const onCommit = vi.fn();
    const root = createSmokeRoot();
    function Probe() {
      const value = useVoiceInput({ onCommit });
      React.useEffect(() => {
        voice = value;
      }, [value]);
      return null;
    }
    await root.render(React.createElement(Probe));
    act(() => voice?.start());
    await flushAsync();
    const sessionId = native.start.mock.calls[0]?.[1] as string;
    native.cancel.mockRejectedValueOnce(new Error("Native cancel unavailable"));
    native.unregister.mockRejectedValueOnce(
      new Error("Listener already closed")
    );
    await root.unmount();
    await flushAsync();
    native.callback?.({ sessionId, kind: "ended", transcript: "late" });
    expect(native.cancel).toHaveBeenCalledWith(sessionId);
    expect(native.unregister).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
