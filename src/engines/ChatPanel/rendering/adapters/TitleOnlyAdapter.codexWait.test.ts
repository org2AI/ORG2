import { createInstance } from "i18next";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import en from "@src/i18n/locales/en/sessions.json";
import zhHant from "@src/i18n/locales/zh-Hant/sessions.json";
import zh from "@src/i18n/locales/zh/sessions.json";

import type { RecipeRendererProps } from "../RecipeRenderer";
import { RecipeRenderer } from "../RecipeRenderer";

vi.mock("@src/engines/ChatPanel/hooks/useChatEventReplay", () => ({
  useChatEventReplay: () => ({
    replayEventById: vi.fn(),
    canReplay: false,
  }),
}));

const { translate } = vi.hoisted(() => ({
  translate: vi.fn(
    (key: string, vars?: Record<string, unknown>) =>
      `${key} ${vars?.waited ?? ""}`
  ),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: translate,
    i18n: { language: "en" },
  }),
}));

describe("TitleOnlyAdapter Codex wait rendering", () => {
  it.each([
    ["Wall time: 45.0141 seconds\nSleep completed.", "45s"],
    ["Wall time: 2.0 seconds\nSleep interrupted.", "2s"],
    ["Sleep completed.", "45s"],
  ])("renders clock sleep elapsed time: %s", (output, waited) => {
    const markup = renderToStaticMarkup(
      createElement(RecipeRenderer, {
        event_id: "event-codex-sleep",
        functionName: "await_output",
        uiCanonical: "await_output",
        action_type: "tool_call",
        args: {
          command: "wait_for",
          duration_ms: 45000,
          block_until_ms: 45000,
        },
        result: { output },
        status: "completed",
      })
    );
    expect(markup).toContain('data-tool-call-name="await_output"');
    expect(markup).toContain(`tools.awaitOutputDone ${waited}`);
    expect(markup).not.toContain("duration_ms");
    expect(markup).not.toContain("Sleep completed.");
  });

  it("renders a Codex write_stdin poll with its envelope wall time", () => {
    const markup = renderToStaticMarkup(
      createElement(RecipeRenderer, {
        event_id: "event-codex-poll",
        functionName: "await_output",
        uiCanonical: "await_output",
        action_type: "tool_call",
        args: {
          command: "wait_for",
          handle: "10689",
          handles: ["10689"],
          session_id: "10689",
          chars: "",
          block_until_ms: 1000,
        },
        result: {
          output:
            "Script completed\nWall time 5.0 seconds\nOutput:\n\n RUN  v4.1.11\n",
        },
        status: "completed",
      })
    );
    expect(markup).toContain('data-tool-call-name="await_output"');
    expect(markup).toContain("tools.awaitOutputDone 5s");
  });

  it("renders Codex wait payloads with the dedicated wait lifecycle", () => {
    const props: RecipeRendererProps = {
      event_id: "event-codex-wait",
      functionName: "await_output",
      uiCanonical: "await_output",
      action_type: "tool_call",
      args: { cell_id: "12", max_tokens: 4000, yield_time_ms: 1000 },
      result: {
        observation:
          "Script running with cell ID 12\nWall time 1.0 seconds\nOutput:",
      },
      status: "completed",
    };

    const markup = renderToStaticMarkup(createElement(RecipeRenderer, props));

    expect(markup).toContain('data-tool-call-name="await_output"');
    expect(markup).toContain("tools.awaitOutputDone");
    expect(markup).not.toContain("cell_id");
    expect(markup).not.toContain("Script running with cell ID");
  });
});

describe("wait summary localization", () => {
  it.each([
    ["zh", zh, "等待后台任务45s", "等待终端进程45s", "等待2个终端进程45s"],
    [
      "zh-Hant",
      zhHant,
      "等待後臺任務45s",
      "等待終端進程45s",
      "等待2個終端進程45s",
    ],
    [
      "en",
      en,
      "Waited 45s for a background task",
      "Waited 45s for a terminal process",
      "Waited 45s for 2 terminal processes",
    ],
  ])(
    "omits single counts and preserves locale spacing in %s",
    async (lng, resource, unknown, single, multiple) => {
      const i18n = createInstance();
      await i18n.init({
        lng,
        resources: { [lng]: { translation: resource } },
        interpolation: { escapeValue: false },
      });
      translate.mockImplementation((key, vars) => i18n.t(key, vars));
      try {
        for (const [count, expected] of [
          [0, unknown],
          [1, single],
          [2, multiple],
        ] as const) {
          translate.mockClear();
          renderToStaticMarkup(
            createElement(RecipeRenderer, {
              event_id: "wait-summary",
              functionName: "await_output",
              uiCanonical: "await_output",
              action_type: "tool_call",
              args: { command: "wait_for", duration_ms: 45000 },
              status: "completed",
              result: {
                output:
                  "awaitMeta::" +
                  JSON.stringify({
                    items: Array.from({ length: count }, (_, index) => ({
                      handle: String(index),
                      jobKind: "shell",
                      status: "succeeded",
                      waitedMs: 45000,
                    })),
                  }),
              },
            })
          );
          const vars = translate.mock.calls.find(
            ([, vars]) => typeof vars?.summary === "string"
          )?.[1];
          expect(vars).toBeDefined();
          expect(i18n.t("tools.awaitOutputWaitForDone", vars)).toBe(expected);
        }
      } finally {
        translate.mockImplementation(
          (key, vars) => `${key} ${vars?.waited ?? ""}`
        );
      }
    }
  );
});
