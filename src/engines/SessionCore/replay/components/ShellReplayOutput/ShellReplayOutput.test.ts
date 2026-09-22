// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rpc } from "@src/api/tauri/rpc";
import type { ShellReplayState } from "@src/engines/SessionCore/core/types";

import { ShellReplayOutput } from ".";
import {
  shellReplayRangeCache,
  shellReplayScopeKey,
} from "../../shellReplayRange";

vi.mock("@src/api/tauri/rpc", () => ({
  rpc: { sessionCore: { shellReplay: { readRange: vi.fn() } } },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/engines/TerminalCore/components/TerminalDisplay", () => ({
  TerminalCommand: ({ command }: { command: string }) =>
    createElement("span", null, command),
}));
vi.mock("@src/hooks/terminal/useTerminalSurfaceStyle", () => ({
  useTerminalSurfaceStyle: () => ({}),
}));

const state: ShellReplayState = {
  ref: { sessionId: "session-a", callId: "call-a", formatVersion: 1 },
  bookmark: { visibleThroughSequence: 1, visibleBytes: 5 },
  terminalPreview: "tail",
  status: "complete",
};
const range = {
  frames: [
    {
      sequence: 1,
      stream: "stdout" as const,
      byteStart: 0,
      byteEnd: 5,
      text: "full\n",
    },
  ],
  nextOffsetBytes: 5,
  eof: true,
};
function cacheOutput() {
  shellReplayRangeCache.setWindow(
    shellReplayScopeKey("session-a", "call-a", 1, 5),
    {
      frames: range.frames,
      earliestOffset: 0,
      latestOffset: 5,
    }
  );
}
function panel(replayState = state) {
  return createElement(ShellReplayOutput, {
    command: "printf full",
    replayRef: replayState.ref,
    replayState,
    exitCode: 0,
  });
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.mocked(rpc.sessionCore.shellReplay.readRange).mockResolvedValue(range);
  shellReplayRangeCache.clear();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  shellReplayRangeCache.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ShellReplayOutput initial hydration", () => {
  it("renders cached output on the first paint before effects run", () => {
    cacheOutput();
    const markup = renderToStaticMarkup(panel());
    expect(markup).toContain(">full</pre>");
    expect(markup).not.toContain(">tail</pre>");
  });

  it("keeps cached output through mount without scheduling a read", async () => {
    cacheOutput();
    await act(async () => root.render(panel()));
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(host.querySelector("pre")?.textContent).toBe("full");
    expect(rpc.sessionCore.shellReplay.readRange).not.toHaveBeenCalled();
  });

  it("loads a cold replay after settling and cancels prefetch on unmount", async () => {
    await act(async () => root.render(panel()));
    expect(host.querySelector("pre")?.textContent).toBe("tail");
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(host.querySelector("pre")?.textContent).toBe("full");
    expect(rpc.sessionCore.shellReplay.readRange).toHaveBeenCalledTimes(1);
    await act(async () =>
      root.render(panel({ ...state, ref: { ...state.ref, callId: "call-b" } }))
    );
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(rpc.sessionCore.shellReplay.readRange).toHaveBeenCalledTimes(1);
  });

  it("never reuses a different command or bookmark's output", () => {
    cacheOutput();
    for (const other of [
      { ...state, ref: { ...state.ref, callId: "call-b" } },
      { ...state, ref: { ...state.ref, sessionId: "session-b" } },
      { ...state, bookmark: { visibleThroughSequence: 2, visibleBytes: 6 } },
    ]) {
      const markup = renderToStaticMarkup(panel(other));
      expect(markup).toContain(">tail</pre>");
      expect(markup).not.toContain(">full</pre>");
    }
  });
});
