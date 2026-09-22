// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getToolIconComponent } from "@src/config/toolIcons";
import { _resetToolRegistry } from "@src/engines/SessionCore/rendering/registry/initToolRegistry";
import { BookOpen02Icon, Search01Icon, Wrench01Icon } from "@src/icons";

import type { TranscriptItem } from "../../lib/transcriptReducer";
import {
  createInitialTranscriptState,
  reduceTranscriptFromUpserts,
} from "../../lib/transcriptReducer";
import { MobileToolCall } from "./MobileToolCall";
import {
  mobileToolSummary,
  normalizeMobileToolLifecycle,
  resolveMobileToolIconName,
} from "./mobileToolPresentation";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { tool?: string }) =>
      options?.tool ? `${key}: ${options.tool}` : key,
  }),
}));

afterEach(() => {
  _resetToolRegistry();
});

describe("resolveMobileToolIconName", () => {
  it("prefers ui canonical over generic function names", () => {
    const item: TranscriptItem = {
      id: "tool-1",
      kind: "tool",
      text: "tool_call",
      toolName: "tool_call",
      toolCanonical: "read_file",
      toolData: {
        kind: "file",
        filePath: "src/a.ts",
        fileName: "a.ts",
        language: "typescript",
      },
    };
    expect(resolveMobileToolIconName(item)).toBe("read_file");
  });

  it("falls back to structured tool kind when names are generic", () => {
    const item: TranscriptItem = {
      id: "tool-2",
      kind: "tool",
      text: "tool",
      toolName: "tool_call",
      toolData: {
        kind: "search",
        query: "merge_events",
        results: [],
        totalMatches: 0,
      },
    };
    expect(resolveMobileToolIconName(item)).toBe("code_search");
  });
});

describe("MobileToolCall", () => {
  it.each(["running", "completed", "failed"])(
    "promotes JS title without repeating it when %s",
    (status) => {
      const title = "确认闪连当前模式和节点";
      const state = reduceTranscriptFromUpserts(
        createInitialTranscriptState(),
        [
          {
            id: "js-title",
            functionName: "js",
            uiCanonical: "tool_call",
            actionType: "tool_call",
            displayStatus: status,
            toolArgumentTitle: title,
            toolSummary: title,
            toolData: { kind: "unknown" },
          },
        ]
      );
      const markup = renderToStaticMarkup(
        React.createElement(MobileToolCall, { item: state.items[0] })
      );
      expect(markup).toContain(`title="${title}"`);
      expect(markup).toContain(`>${title}</span>`);
      expect(markup).not.toContain(">Js</span>");
      expect(markup.split(`>${title}</span>`)).toHaveLength(2);
      expect(markup).toContain("min-w-0 flex-initial truncate");
    }
  );

  it("retains old-server summaries without assuming they are call titles", () => {
    const markup = renderToStaticMarkup(
      React.createElement(MobileToolCall, {
        item: {
          id: "legacy-js",
          kind: "tool",
          text: "js",
          toolName: "js",
          toolSummary: "https://example.com",
        },
      })
    );
    expect(markup).toContain(">Js</span>");
    expect(markup).toContain("https://example.com");
  });

  it("does not promote a business title from the same wire field", () => {
    const markup = renderToStaticMarkup(
      React.createElement(MobileToolCall, {
        item: {
          id: "document",
          kind: "tool",
          text: "create_document",
          toolName: "create_document",
          toolArgumentTitle: "Report",
        },
      })
    );
    expect(markup).toContain(">Create Document</span>");
    expect(markup).not.toContain(">Report</span>");
  });

  it("keeps tool target and current status in its accessible name across updates", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const env = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previous = env.IS_REACT_ACT_ENVIRONMENT;
    env.IS_REACT_ACT_ENVIRONMENT = true;
    const onOpenDetails = vi.fn();
    try {
      for (const [command, status, expectedStatus] of [
        ["pnpm test", "running", "running"],
        ["pnpm test", "failed", "failed"],
        ["pnpm build", "completed", "done"],
      ] as const) {
        await act(async () =>
          root.render(
            React.createElement(MobileToolCall, {
              item: {
                id: "command",
                kind: "tool",
                text: "run_shell",
                toolName: "run_shell",
                toolSummary: command,
                toolStatus: status,
                toolData: {
                  kind: "shell",
                  command,
                  output: "Output stays in details",
                  isFailure: status === "failed",
                },
              },
              onOpenDetails,
            })
          )
        );
        const trigger = host.querySelector("button")!;
        expect(trigger.getAttribute("aria-label")).toBe(
          `transcript.tools.openDetails: transcript.tools.labels.runCommand · ${command} · transcript.tools.status.${expectedStatus}`
        );
        expect(trigger.getAttribute("aria-label")).not.toContain(
          "Output stays in details"
        );
        await act(async () => trigger.click());
      }
      expect(onOpenDetails).toHaveBeenCalledTimes(3);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      env.IS_REACT_ACT_ENVIRONMENT = previous;
    }
  });

  it("renders distinct icons per tool without the desktop tool registry", () => {
    const readItem: TranscriptItem = {
      id: "file-1",
      kind: "tool",
      text: "tool_call",
      toolName: "tool_call",
      toolData: {
        kind: "file",
        filePath: "src/a.ts",
        fileName: "a.ts",
        language: "typescript",
      },
    };
    const searchItem: TranscriptItem = {
      id: "search-1",
      kind: "tool",
      text: "tool_call",
      toolName: "tool_call",
      toolData: {
        kind: "search",
        query: "merge_events",
        results: [],
        totalMatches: 0,
      },
    };

    expect(getToolIconComponent(resolveMobileToolIconName(readItem))).toBe(
      BookOpen02Icon
    );
    expect(getToolIconComponent(resolveMobileToolIconName(searchItem))).toBe(
      Search01Icon
    );
    expect(getToolIconComponent("tool")).toBe(Wrench01Icon);

    const readHtml = renderToStaticMarkup(
      React.createElement(MobileToolCall, { item: readItem })
    );
    const searchHtml = renderToStaticMarkup(
      React.createElement(MobileToolCall, { item: searchItem })
    );
    expect(readHtml).not.toEqual(searchHtml);
  });

  it("renders a compact dialog trigger without inserting details into the transcript", () => {
    const item: TranscriptItem = {
      id: "shell-1",
      kind: "tool",
      text: "run_shell",
      toolName: "run_shell",
      toolCanonical: "run_shell",
      toolStatus: "completed",
      toolSummary: "pnpm test",
      toolData: {
        kind: "shell",
        command: "pnpm test",
        output: "90 tests passed",
        exitCode: 0,
        isFailure: false,
      },
      toolDataTruncated: true,
    };

    const html = renderToStaticMarkup(
      React.createElement(MobileToolCall, {
        item,
        onOpenDetails: vi.fn(),
      })
    );

    expect(html).toContain('data-tool-call-name="run_shell"');
    expect(html).toContain('data-tool-call-layout="inline"');
    expect(html).toContain('data-tool-call-status="done"');
    expect(html).toContain("transcript.tools.labels.runCommand");
    expect(html).toContain("pnpm test");
    expect(html).toContain("chat-block-header");
    expect(html).toContain("chat-block-icon");
    expect(html).not.toContain("chat-code-sm");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('data-tool-call-action="open-details"');
    expect(html).not.toContain("90 tests passed");
    expect(html).not.toContain("transcript.tools.truncated");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
    expect(html).not.toContain("bg-bg-2");
  });

  it("keeps the concrete file path visible while collapsed", () => {
    const item: TranscriptItem = {
      id: "file-1",
      kind: "tool",
      text: "read_file",
      toolName: "read_file",
      toolStatus: "running",
      toolData: {
        kind: "file",
        filePath: "src/modules/MobileRemote/MobileRemoteApp.tsx",
        fileName: "MobileRemoteApp.tsx",
        language: "typescript",
        lineCount: 120,
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(MobileToolCall, { item })
    );

    expect(html).toContain("src/modules/MobileRemote/MobileRemoteApp.tsx");
    expect(html).toContain("transcript.tools.status.running");
    expect(mobileToolSummary(item)).toBe(
      "src/modules/MobileRemote/MobileRemoteApp.tsx"
    );
  });

  it("keeps status labels in a fixed trailing column", () => {
    const shortSummaryItem: TranscriptItem = {
      id: "search-short",
      kind: "tool",
      text: "tool_call",
      toolName: "tool_call",
      toolStatus: "completed",
      toolData: {
        kind: "search",
        query: "would_downgrade_terminal",
        results: [],
        totalMatches: 0,
      },
    };
    const longSummaryItem: TranscriptItem = {
      id: "file-long",
      kind: "tool",
      text: "read_file",
      toolName: "read_file",
      toolStatus: "completed",
      toolData: {
        kind: "file",
        filePath: "src/modules/MobileRemote/MobileRemoteApp.tsx",
        fileName: "MobileRemoteApp.tsx",
        language: "typescript",
      },
    };

    const shortHtml = renderToStaticMarkup(
      React.createElement(MobileToolCall, { item: shortSummaryItem })
    );
    const longHtml = renderToStaticMarkup(
      React.createElement(MobileToolCall, { item: longSummaryItem })
    );

    for (const [html, summary] of [
      [shortHtml, '"would_downgrade_terminal"'],
      [longHtml, "src/modules/MobileRemote/MobileRemoteApp.tsx"],
    ]) {
      const container = document.createElement("div");
      container.innerHTML = html;
      const status = container.querySelector(
        '[data-mobile-tool-status-trailing="true"]'
      );
      expect(status?.textContent).toContain("transcript.tools.status.done");

      // Assert the two layout columns, independent of wrappers used to size
      // the icon/text hover target inside the flexible content column.
      const trailingColumn = status?.parentElement;
      const contentColumn = trailingColumn?.previousElementSibling;
      expect(trailingColumn?.classList.contains("shrink-0")).toBe(true);
      expect(contentColumn?.classList.contains("flex-1")).toBe(true);
      expect(contentColumn?.textContent).toContain(summary);
      expect(contentColumn?.textContent).not.toContain(
        "transcript.tools.status.done"
      );
      expect(trailingColumn?.textContent).not.toContain(summary);
    }
  });

  it("formats grep alternation queries as readable comma-separated subtitles", () => {
    const item: TranscriptItem = {
      id: "search-alt",
      kind: "tool",
      text: "tool_call",
      toolName: "tool_call",
      toolStatus: "completed",
      toolData: {
        kind: "search",
        query: "call_id_index|tool_result|merge_events",
        results: [],
        totalMatches: 0,
      },
    };

    expect(mobileToolSummary(item)).toBe(
      '"call_id_index, tool_result, merge_events"'
    );
  });

  it("maps failed and waiting states without relying on color alone", () => {
    expect(normalizeMobileToolLifecycle("failed")).toBe("failed");
    expect(normalizeMobileToolLifecycle("waiting_for_user")).toBe("running");
    expect(normalizeMobileToolLifecycle("completed")).toBe("done");
  });
});
