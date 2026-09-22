// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { TranscriptRoundSummary } from "../../lib/transcriptLoadState";
import type { TranscriptItem } from "../../lib/transcriptReducer";
import {
  MobileRemotePlatformProvider,
  type MobileRemotePlatformProviderProps,
} from "../../platform/MobileRemotePlatformContext";
import { createBrowserMobileRemotePlatform } from "../../platform/browser";
import { ChatTranscript } from "./ChatTranscript";
import type { MobileFileTarget } from "./mobileFileTool";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { duration?: string }) =>
      options?.duration ? `${key} ${options.duration}` : key,
  }),
}));

vi.mock("./AgentBubble", () => ({
  AgentBubble: ({
    text,
    children,
  }: {
    text: string;
    children?: React.ReactNode;
  }) => React.createElement("div", null, text, children),
}));

vi.mock("./UserBubble", () => ({
  UserBubble: ({
    text,
    children,
  }: {
    text: string;
    children?: React.ReactNode;
  }) => React.createElement("div", null, text, children),
}));

vi.mock("@src/components/FileTypeIcon", () => ({
  default: ({ fileName }: { fileName: string }) =>
    React.createElement("span", { "data-file-icon": fileName }),
}));

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }

  observe = vi.fn();
  disconnect = vi.fn();

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const USER_ITEM: TranscriptItem = {
  id: "user-1",
  kind: "user",
  text: "First question",
};
const platform = createBrowserMobileRemotePlatform();

describe("ChatTranscript tail follow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollHeight = 1_000;
  let clientHeight = 300;
  let scrollTop = 0;
  let nextFrameId = 1;
  let frameCallbacks = new Map<number, FrameRequestCallback>();
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    scrollHeight = 1_000;
    clientHeight = 300;
    scrollTop = 0;
    nextFrameId = 1;
    frameCallbacks = new Map();
    ResizeObserverStub.instances = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      frameCallbacks.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (frameId: number) => {
      frameCallbacks.delete(frameId);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  const renderTranscript = async (
    items: TranscriptItem[],
    options: {
      sessionId?: string;
      roundId?: string;
      round?: TranscriptRoundSummary;
      forceFollowKey?: string;
      waitingForAgent?: boolean;
      onOpenFile?: (eventId: string, target: MobileFileTarget) => Promise<void>;
      loadImage?: (eventId: string, index: number) => Promise<string>;
      imageScope?: string;
    } = {}
  ) => {
    await act(async () => {
      root.render(
        React.createElement(
          MobileRemotePlatformProvider,
          { platform } as MobileRemotePlatformProviderProps,
          React.createElement(ChatTranscript, {
            sessionId: options.sessionId ?? "session-1",
            roundId: options.roundId,
            round: options.round,
            items,
            phase: "ready",
            forceFollowKey: options.forceFollowKey,
            waitingForAgent: options.waitingForAgent,
            onOpenFile: options.onOpenFile,
            onRetry: vi.fn(),
            loadImage: options.loadImage,
            imageScope: options.imageScope ?? "endpoint/account/desktop",
          })
        )
      );
    });
    const scrollRoot = container.querySelector<HTMLDivElement>("[role=log]");
    if (!scrollRoot) throw new Error("transcript scroll root did not render");
    Object.defineProperties(scrollRoot, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, get: () => clientHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });
    return scrollRoot;
  };

  const flushFrames = () => {
    act(() => {
      const callbacks = [...frameCallbacks.values()];
      frameCallbacks.clear();
      callbacks.forEach((callback) => callback(performance.now()));
    });
  };

  const completedRound: TranscriptRoundSummary = {
    id: "round-1",
    status: "completed",
    durationMs: 198_000,
  };
  const workedItems: TranscriptItem[] = [
    USER_ITEM,
    { id: "progress", kind: "agent", text: "Checking the repository" },
    {
      id: "tool",
      kind: "tool",
      text: "read_file",
      toolName: "read_file",
      toolCanonical: "read_file",
      toolStatus: "completed",
      toolData: {
        kind: "file",
        filePath: "/repo/session.ts",
        fileName: "session.ts",
        language: "typescript",
        lineCount: 1,
      },
    },
    { id: "answer", kind: "agent", text: "Final answer" },
  ];
  const workToggle = () =>
    container.querySelector<HTMLButtonElement>(".mobile-turn-summary button");

  it("folds completed work below the prompt, keeps the answer, and restores tool interactions on expand", async () => {
    await renderTranscript(workedItems, {
      roundId: "round-1",
      round: completedRound,
    });
    expect(workToggle()?.textContent).toContain("3m 18s");
    expect(workToggle()?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).toContain("First question");
    expect(container.textContent).toContain("Final answer");
    expect(container.textContent).not.toContain("Checking the repository");
    expect(
      container.querySelector('[data-transcript-item-kind="tool"]')
    ).toBeNull();
    await act(async () => workToggle()!.click());
    expect(workToggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Checking the repository");
    const readingPosition = scrollTop;
    scrollHeight = 2_000;
    act(() =>
      ResizeObserverStub.instances.forEach((observer) => observer.trigger())
    );
    flushFrames();
    expect(scrollTop).toBe(readingPosition);
    expect(
      container.querySelector('button[aria-label="transcript.scrollToBottom"]')
    ).not.toBeNull();
    const tool = container.querySelector<HTMLButtonElement>(
      '[data-tool-call-name="read_file"]'
    )!;
    await act(async () => tool.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await renderTranscript(workedItems, {
      sessionId: "other",
      roundId: "round-1",
      round: completedRound,
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(workToggle()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps live output expanded then folds on completion, preserving a manual expansion across updates", async () => {
    await renderTranscript(workedItems, {
      roundId: "round-1",
      round: { ...completedRound, status: "pending" },
    });
    expect(workToggle()).toBeNull();
    expect(container.textContent).toContain("Checking the repository");
    await renderTranscript(workedItems, {
      roundId: "round-1",
      round: completedRound,
    });
    expect(workToggle()?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => workToggle()!.click());
    await renderTranscript([...workedItems], {
      roundId: "round-1",
      round: { ...completedRound, durationMs: 200_000 },
    });
    expect(workToggle()?.getAttribute("aria-expanded")).toBe("true");
    await renderTranscript(workedItems, {
      roundId: "round-2",
      round: { ...completedRound, id: "round-2" },
    });
    expect(workToggle()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("preserves loaded prompt and final images through completion and busy transitions", async () => {
    const loadImage = vi
      .fn()
      .mockResolvedValue("data:image/jpeg;base64,aGVsbG8=");
    const items = workedItems.map((item) => ({
      ...item,
      imageCount: item.id === USER_ITEM.id || item.id === "answer" ? 1 : 0,
    }));
    const options = { roundId: "round-1", loadImage };
    await renderTranscript([items[0]], {
      ...options,
      round: { ...completedRound, status: "pending" },
    });
    const promptLoad = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("images.load")
    )!;
    await act(async () => promptLoad.click());
    const promptImage = container.querySelector("img");
    expect(promptImage).not.toBeNull();
    await renderTranscript(items, {
      ...options,
      round: { ...completedRound, status: "pending" },
    });
    expect(container.querySelector("img")).toBe(promptImage);
    const loadButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent?.includes("images.load")
    );
    for (const button of loadButtons) await act(async () => button.click());
    const originalImages = Array.from(container.querySelectorAll("img"));
    const originalPrompt = container.querySelector(
      '[data-transcript-item-kind="user"]'
    );
    expect(originalImages).toHaveLength(2);
    const assertPreserved = () => {
      const images = container.querySelectorAll("img");
      expect(images).toHaveLength(2);
      originalImages.forEach((image, index) =>
        expect(images[index]).toBe(image)
      );
      expect(
        container.querySelector('[data-transcript-item-kind="user"]')
      ).toBe(originalPrompt);
      expect(loadImage).toHaveBeenCalledTimes(2);
    };
    await renderTranscript(items, { ...options, round: completedRound });
    assertPreserved();
    expect(workToggle()?.getAttribute("aria-expanded")).toBe("false");
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await renderTranscript(items, {
        ...options,
        round: completedRound,
        waitingForAgent: true,
      });
      expect(workToggle()).toBeNull();
      assertPreserved();
      await renderTranscript(items, { ...options, round: completedRound });
      assertPreserved();
    }
    await act(async () => workToggle()!.click());
    assertPreserved();
    await act(async () => workToggle()!.click());
    assertPreserved();
    await renderTranscript(items, {
      ...options,
      roundId: "other-round",
      round: completedRound,
    });
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("preserves expanded tool rows during busy and terminal-state transitions", async () => {
    await renderTranscript(workedItems, {
      roundId: "round-1",
      round: { ...completedRound, status: "pending" },
    });
    const originalTool = container.querySelector(
      '[data-transcript-item-kind="tool"]'
    );
    expect(originalTool).not.toBeNull();
    for (const status of ["failed", "cancelled", "interrupted"]) {
      await renderTranscript(workedItems, {
        roundId: "round-1",
        round: { ...completedRound, status },
      });
      expect(
        container.querySelector('[data-transcript-item-kind="tool"]')
      ).toBe(originalTool);
      await renderTranscript(workedItems, {
        roundId: "round-1",
        round: { ...completedRound, status },
        waitingForAgent: true,
      });
      expect(
        container.querySelector('[data-transcript-item-kind="tool"]')
      ).toBe(originalTool);
    }
  });

  it.each(["completed", "failed", "cancelled", "interrupted"])(
    "folds every tool outcome in a %s round and restores the original order when expanded",
    async (status) => {
      const failedItems: TranscriptItem[] = [
        ...workedItems.slice(0, -1),
        {
          id: "failure-1",
          kind: "tool",
          text: "failed command one",
          toolStatus: "failed",
        },
        {
          id: "failure-2",
          kind: "tool",
          text: "failed command two",
          toolStatus: "failed",
        },
        workedItems[workedItems.length - 1],
      ];
      await renderTranscript(failedItems, {
        round: { ...completedRound, status },
      });
      if (status !== "completed") {
        expect(workToggle()?.getAttribute("aria-expanded")).toBe("true");
        await act(async () => workToggle()!.click());
      }
      expect(workToggle()?.getAttribute("aria-expanded")).toBe("false");
      expect(
        container.querySelectorAll('[data-transcript-item-kind="tool"]')
      ).toHaveLength(0);
      expect(container.textContent).toContain("Final answer");
      expect(container.textContent).not.toContain("failed command");
      await act(async () => workToggle()!.click());
      expect(
        container.querySelectorAll('[data-transcript-item-kind="tool"]')
      ).toHaveLength(3);
      expect(container.textContent!.indexOf("failed command one")).toBeLessThan(
        container.textContent!.indexOf("failed command two")
      );
      await act(async () => workToggle()!.click());
      expect(
        container.querySelectorAll('[data-transcript-item-kind="tool"]')
      ).toHaveLength(0);
      expect(
        failedItems.filter((item) => item.toolStatus === "failed")
      ).toHaveLength(2);
    }
  );

  it("can collapse and reopen a failed tool-only round without a final reply", async () => {
    await renderTranscript(
      [
        USER_ITEM,
        {
          id: "failed-only",
          kind: "tool",
          text: "failed without answer",
          toolStatus: "failed",
        },
      ],
      {
        round: { ...completedRound, status: "failed" },
      }
    );
    expect(workToggle()?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => workToggle()!.click());
    expect(container.textContent).not.toContain("failed without answer");
    expect(container.textContent).toContain("First question");
    await act(async () => workToggle()!.click());
    expect(container.textContent).toContain("failed without answer");
  });

  it("does not fold streaming, empty, or legacy multi-round transcripts and does not invent missing duration", async () => {
    await renderTranscript(workedItems);
    expect(workToggle()).toBeNull();
    await renderTranscript([USER_ITEM], { round: completedRound });
    expect(container.querySelector(".mobile-turn-summary")).toBeNull();
    await renderTranscript(
      [
        ...workedItems,
        { id: "new", kind: "agent", text: "Live", streaming: true },
      ],
      { round: completedRound }
    );
    expect(workToggle()).toBeNull();
    await renderTranscript(
      [
        ...workedItems,
        { id: "next-user", kind: "user", text: "Next question" },
      ],
      { round: completedRound }
    );
    expect(workToggle()).toBeNull();
    await renderTranscript(workedItems, {
      round: { id: "unknown-time", status: "completed" },
    });
    expect(workToggle()?.textContent).toBe("transcript.workSummary");
  });

  it("keeps tool-only work expandable and shows a static summary for an answer with nothing to fold", async () => {
    await renderTranscript(
      workedItems.slice(0, 3).filter((item) => item.kind !== "agent"),
      {
        round: {
          id: "timed",
          status: "completed",
          startedAt: "2026-09-16T00:00:00Z",
          endedAt: "2026-09-16T00:03:18Z",
        },
      }
    );
    expect(workToggle()?.textContent).toContain("3m 18s");
    expect(
      container.querySelector('[data-transcript-item-kind="tool"]')
    ).toBeNull();
    await act(async () => workToggle()!.click());
    expect(
      container.querySelector('[data-transcript-item-kind="tool"]')
    ).not.toBeNull();
    await renderTranscript([USER_ITEM, workedItems[3]], {
      round: completedRound,
    });
    expect(workToggle()).toBeNull();
    expect(
      container.querySelector(".mobile-turn-summary")?.textContent
    ).toContain("3m 18s");
    expect(container.textContent).toContain("Final answer");
  });

  it("mounts event image controls in the transcript and clears them on round change", async () => {
    const loadImage = vi
      .fn()
      .mockResolvedValue("data:image/jpeg;base64,aGVsbG8=");
    await renderTranscript(
      [{ id: "photo", kind: "user", text: "caption", imageCount: 1 }],
      { roundId: "one", loadImage }
    );
    const button = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("images.load")
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(loadImage).toHaveBeenCalledWith("photo", 0);
    expect(container.querySelector("img")).not.toBeNull();
    await renderTranscript(
      [{ id: "photo", kind: "user", text: "other", imageCount: 1 }],
      { roundId: "two", loadImage }
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps loaded user and agent previews offline, disables unloaded images and recovers on demand", async () => {
    const items: TranscriptItem[] = [
      { id: "user-photo", kind: "user", text: "caption", imageCount: 1 },
      { id: "agent-photo", kind: "agent", text: "result", imageCount: 2 },
    ];
    const url = "data:image/jpeg;base64,aGVsbG8=";
    const loadImage = vi.fn().mockResolvedValue(url);
    const loadButtons = () =>
      Array.from(container.querySelectorAll("button")).filter((button) =>
        button.textContent?.includes("images.load")
      );
    await renderTranscript(items, { loadImage });
    await act(async () => loadButtons()[0].click());
    await act(async () => loadButtons()[0].click());
    expect(container.querySelectorAll("img")).toHaveLength(2);
    await renderTranscript(items);
    expect(container.querySelectorAll("img")).toHaveLength(2);
    const offlineButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("images.unavailable")
    )!;
    expect(offlineButton.disabled).toBe(true);
    await act(async () => offlineButton.click());
    expect(loadImage).toHaveBeenCalledTimes(2);
    const restoredLoad = vi.fn().mockResolvedValue(url);
    await renderTranscript(items, { loadImage: restoredLoad });
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(restoredLoad).not.toHaveBeenCalled();
    await act(async () => loadButtons()[0].click());
    expect(restoredLoad).toHaveBeenCalledOnce();
    expect(container.querySelectorAll("img")).toHaveLength(3);
  });

  it.each(["endpoint", "account", "desktop", "session", "round"])(
    "clears ready images and rejects pending results on %s switch, even with the same loader",
    async (changedScope) => {
      const items: TranscriptItem[] = [
        { id: "photo", kind: "user", text: "caption", imageCount: 2 },
      ];
      const url = "data:image/jpeg;base64,aGVsbG8=";
      let resolve!: (value: string) => void;
      const loadImage = vi
        .fn()
        .mockResolvedValueOnce(url)
        .mockImplementationOnce(
          () =>
            new Promise<string>((done) => {
              resolve = done;
            })
        );
      const scope = { endpoint: "a", account: "a", desktop: "a" };
      const options = {
        imageScope: JSON.stringify(scope),
        sessionId: "session",
        roundId: "round",
        loadImage,
      };
      await renderTranscript(items, options);
      const loadButtons = () =>
        Array.from(container.querySelectorAll("button")).filter((button) =>
          button.textContent?.includes("images.load")
        );
      await act(async () => loadButtons()[0].click());
      act(() => loadButtons()[0].click());
      expect(container.querySelectorAll("img")).toHaveLength(1);
      await renderTranscript(items, {
        ...options,
        imageScope: JSON.stringify({
          ...scope,
          ...(["endpoint", "account", "desktop"].includes(changedScope)
            ? { [changedScope]: "b" }
            : {}),
        }),
        sessionId: changedScope === "session" ? "other-session" : "session",
        roundId: changedScope === "round" ? "other-round" : "round",
      });
      expect(container.querySelector("img")).toBeNull();
      await act(async () => resolve(url));
      expect(container.querySelector("img")).toBeNull();
      expect(loadButtons()).toHaveLength(2);
    }
  );

  it("retains at most eight previews across message rows and reconnects", async () => {
    const items: TranscriptItem[] = Array.from({ length: 9 }, (_, index) => ({
      id: `photo-${index}`,
      kind: index % 2 === 0 ? "user" : "agent",
      text: "photo",
      imageCount: 1,
    }));
    const loadImage = vi
      .fn()
      .mockResolvedValue("data:image/jpeg;base64,aGVsbG8=");
    await renderTranscript(items, { loadImage });
    const buttons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent?.includes("images.load")
    );
    for (const button of buttons) await act(async () => button.click());
    expect(loadImage).toHaveBeenCalledTimes(9);
    expect(container.querySelectorAll("img")).toHaveLength(8);
    await renderTranscript(items);
    expect(container.querySelectorAll("img")).toHaveLength(8);
    await renderTranscript(items, { loadImage });
    expect(loadImage).toHaveBeenCalledTimes(9);
    expect(container.querySelectorAll("img")).toHaveLength(8);
  });

  it("follows appended and streaming content while the reader is at the bottom", async () => {
    await renderTranscript([USER_ITEM]);
    const agentItem: TranscriptItem = {
      id: "agent-1",
      kind: "agent",
      text: "Working",
      streaming: true,
    };

    await renderTranscript([USER_ITEM, agentItem]);
    expect(scrollTop).toBe(700);

    scrollHeight = 1_200;
    await renderTranscript([
      USER_ITEM,
      { ...agentItem, text: "Working with a longer streamed answer" },
    ]);
    expect(scrollTop).toBe(900);
  });

  it("fills the transcript area and labels initial history loading", async () => {
    vi.useFakeTimers();

    await act(async () => {
      root.render(
        React.createElement(
          MobileRemotePlatformProvider,
          { platform } as MobileRemotePlatformProviderProps,
          React.createElement(ChatTranscript, {
            sessionId: "session-1",
            items: [],
            phase: "loading",
            onRetry: vi.fn(),
          })
        )
      );
    });

    const loading = container.querySelector(
      '[data-mobile-transcript-loading="true"]'
    );
    expect(loading).not.toBeNull();
    expect(loading?.classList.contains("flex-1")).toBe(true);
    expect(loading?.classList.contains("min-h-0")).toBe(true);
    expect(loading?.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(
      loading?.querySelector('[role="status"]')?.getAttribute("aria-label")
    ).toBe("transcript.loading");
    expect(
      loading?.querySelectorAll(".mobile-loading-dots > span").length
    ).toBe(3);

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(container.textContent).not.toContain("transcript.loading");
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange"))
    );
    expect(
      loading
        ?.querySelector(".mobile-loading-dots")
        ?.getAttribute("data-paused")
    ).toBe("true");
    hidden.mockReturnValue(false);
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange"))
    );
    expect(
      loading
        ?.querySelector(".mobile-loading-dots")
        ?.getAttribute("data-paused")
    ).toBe("false");
    hidden.mockRestore();
    await renderTranscript([USER_ITEM]);
    expect(
      container.querySelector('[data-mobile-transcript-loading="true"]')
    ).toBeNull();
    expect(container.textContent).toContain("First question");
  });

  it("shows the shared ChatPanel loading block while waiting for first Agent output", async () => {
    await renderTranscript(
      [
        USER_ITEM,
        {
          id: "mobile-user-turn-2",
          kind: "user",
          text: "New local question",
          optimistic: true,
          turnIntentId: "turn-2",
        },
      ],
      { forceFollowKey: "turn-2", waitingForAgent: true }
    );

    expect(
      container.querySelector('[data-mobile-agent-loading="true"]')
    ).not.toBeNull();
    expect(container.querySelector(".mobile-loading-dots")).not.toBeNull();

    await renderTranscript(
      [
        USER_ITEM,
        {
          id: "agent-turn-2",
          kind: "agent",
          text: "Working",
          streaming: true,
        },
      ],
      { forceFollowKey: "turn-2", waitingForAgent: false }
    );

    expect(
      container.querySelector('[data-mobile-agent-loading="true"]')
    ).toBeNull();
  });

  it("does not steal the viewport after the reader scrolls up", async () => {
    const scrollRoot = await renderTranscript([USER_ITEM]);
    await renderTranscript([
      USER_ITEM,
      { id: "agent-1", kind: "agent", text: "Existing answer" },
    ]);
    scrollTop = 100;
    scrollRoot.dispatchEvent(new Event("scroll"));
    ResizeObserverStub.instances.forEach((observer) => observer.trigger());
    expect(scrollTop).toBe(100);
    flushFrames();

    scrollHeight = 1_200;
    await renderTranscript([
      USER_ITEM,
      { id: "agent-1", kind: "agent", text: "A longer existing answer" },
    ]);

    expect(scrollTop).toBe(100);
    const scrollButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="transcript.scrollToBottom"]'
    );
    expect(scrollButton).not.toBeNull();

    act(() => scrollButton?.click());
    expect(scrollTop).toBe(900);
  });

  it("resumes following after the reader returns near the bottom", async () => {
    const scrollRoot = await renderTranscript([USER_ITEM]);
    scrollTop = 100;
    scrollRoot.dispatchEvent(new Event("scroll"));
    flushFrames();

    scrollTop = 670;
    scrollRoot.dispatchEvent(new Event("scroll"));
    flushFrames();

    scrollHeight = 1_200;
    await renderTranscript([
      USER_ITEM,
      { id: "agent-1", kind: "agent", text: "New answer" },
    ]);
    expect(scrollTop).toBe(900);
  });

  it("forces the new local turn into view and resets follow on session switch", async () => {
    const scrollRoot = await renderTranscript([USER_ITEM]);
    scrollTop = 100;
    scrollRoot.dispatchEvent(new Event("scroll"));
    flushFrames();

    scrollHeight = 1_300;
    await renderTranscript(
      [
        USER_ITEM,
        {
          id: "mobile-user-turn-2",
          kind: "user",
          text: "New local question",
          optimistic: true,
          turnIntentId: "turn-2",
        },
      ],
      { forceFollowKey: "turn-2" }
    );
    expect(scrollTop).toBe(1_000);

    scrollTop = 120;
    scrollRoot.dispatchEvent(new Event("scroll"));
    flushFrames();
    scrollHeight = 900;
    await renderTranscript(
      [{ id: "session-2-user", kind: "user", text: "Other session" }],
      { sessionId: "session-2" }
    );
    expect(scrollTop).toBe(600);
  });

  it("resets follow when the selected round changes in the same session", async () => {
    const scrollRoot = await renderTranscript([USER_ITEM], { roundId: "r3" });
    scrollTop = 100;
    scrollRoot.dispatchEvent(new Event("scroll"));
    flushFrames();

    scrollHeight = 800;
    await renderTranscript(
      [{ id: "old-round-user", kind: "user", text: "Earlier question" }],
      { roundId: "r1" }
    );
    expect(scrollTop).toBe(500);
  });

  it("routes structured tools through the compact mobile tool renderer", async () => {
    const onOpenFile = vi.fn(() => Promise.resolve());
    await renderTranscript(
      [
        USER_ITEM,
        {
          id: "tool-read-1",
          kind: "tool",
          text: "read_file",
          toolName: "read_file",
          toolCanonical: "read_file",
          toolStatus: "completed",
          toolSummary: "/repo/src/session.ts",
          toolData: {
            kind: "file",
            filePath: "/repo/src/session.ts",
            fileName: "session.ts",
            language: "typescript",
            lineCount: 42,
          },
        },
      ],
      { roundId: "round-1", onOpenFile }
    );

    const tool = container.querySelector<HTMLElement>(
      '[data-tool-call-name="read_file"]'
    );
    const toolItem = container.querySelector<HTMLElement>(
      '[data-transcript-item-kind="tool"]'
    );
    expect(tool).not.toBeNull();
    expect(toolItem?.classList.contains("py-0.5")).toBe(true);
    expect(toolItem?.classList.contains("px-2")).toBe(true);
    expect(tool?.textContent).toContain("transcript.tools.labels.readFile");
    expect(tool?.textContent).toContain("/repo/src/session.ts");
    expect(tool?.textContent).not.toBe("read_file");
    expect(tool?.querySelector("details")).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      (tool as HTMLButtonElement).click();
    });

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(
      dialog?.querySelector(
        '[data-mobile-file-document="/repo/src/session.ts"]'
      )
    ).not.toBeNull();
    expect(dialog?.textContent).toContain("session.ts");
    expect(dialog?.textContent).not.toContain('"lineCount": 42');
    expect(tool?.getAttribute("aria-expanded")).toBe("true");
    expect(toolItem?.textContent).not.toContain('"lineCount": 42');

    const openFile = dialog?.querySelector<HTMLButtonElement>(
      '[data-mobile-open-file="/repo/src/session.ts"]'
    );
    expect(openFile).not.toBeNull();
    await act(async () => {
      openFile?.click();
      await Promise.resolve();
    });
    expect(onOpenFile).toHaveBeenCalledWith(
      "tool-read-1",
      expect.objectContaining({
        targetIndex: 0,
        filePath: "/repo/src/session.ts",
      })
    );

    await renderTranscript(
      [
        USER_ITEM,
        {
          id: "tool-read-1",
          kind: "tool",
          text: "read_file",
          toolName: "read_file",
          toolCanonical: "read_file",
          toolStatus: "completed",
          toolSummary: "/repo/src/session.ts",
          toolData: {
            kind: "file",
            filePath: "/repo/src/session.ts",
            fileName: "session.ts",
            language: "typescript",
            lineCount: 84,
          },
        },
      ],
      { roundId: "round-1", onOpenFile }
    );

    expect(
      document.body.querySelector('[role="dialog"]')?.textContent
    ).toContain("session.ts");
    expect(
      document.body.querySelector('[role="dialog"]')?.textContent
    ).not.toContain('"lineCount": 84');
  });
});
