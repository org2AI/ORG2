import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import TerminalBlock from ".";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("TerminalBlock shell replay", () => {
  it("highlights commands only while the chat body is expanded", () => {
    const command = "git status --short";
    const expanded = renderToStaticMarkup(
      createElement(TerminalBlock, { command, defaultCollapsed: false })
    );
    expect(expanded).toContain('class="token function">git</span>');
    expect(expanded).toContain('class="token parameter">--short</span>');
    const collapsed = renderToStaticMarkup(
      createElement(TerminalBlock, { command, defaultCollapsed: true })
    );
    expect(collapsed).not.toContain('class="token');
  });

  it("renders the bounded replay preview in the expanded chat body", () => {
    const markup = renderToStaticMarkup(
      createElement(TerminalBlock, {
        command: "printf replay",
        output: "legacy output must not win",
        defaultCollapsed: false,
        eventId: "tool-call-1",
        sessionId: "session-1",
        replayRef: {
          sessionId: "session-1",
          callId: "call-1",
          formatVersion: 1,
        },
        replayState: {
          ref: {
            sessionId: "session-1",
            callId: "call-1",
            formatVersion: 1,
          },
          bookmark: {
            visibleThroughSequence: 2,
            visibleBytes: 18,
          },
          terminalPreview: "bounded replay tail",
          status: "running",
        },
      })
    );

    expect(markup).toContain("bounded replay tail");
    expect(markup).not.toContain("legacy output must not win");
    expect(markup).toContain("max-height:min(320px, 30vh)");
    expect(markup).toContain(
      "--simulator-shell-font-family:var(--app-font-family)"
    );
    expect(markup).toContain(
      "--simulator-shell-font-size:var(--chat-code-font-size, 13px)"
    );
    expect(markup).toContain("--simulator-shell-letter-spacing:normal");
    expect(markup).toContain("--simulator-shell-line-height:1.5");
  });
});
