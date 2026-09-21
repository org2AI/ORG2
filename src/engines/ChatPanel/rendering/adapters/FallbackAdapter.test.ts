import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AgentTurnContext } from "../../ChatHistory/AgentTurnContext";
import type { RecipeRendererProps } from "../RecipeRenderer";
import { RecipeRenderer } from "../RecipeRenderer";

vi.mock("@src/engines/ChatPanel/hooks/useChatEventReplay", () => ({
  useChatEventReplay: () => ({
    replayEventById: vi.fn(),
    canReplay: false,
  }),
}));

function renderFallbackEvent(
  result: Record<string, unknown>,
  status: "completed" | "failed" = "completed"
) {
  const props: RecipeRendererProps = {
    event_id: "event-uncategorized-test",
    functionName: "uncategorized_tool",
    uiCanonical: "tool_call",
    action_type: "tool_call",
    args: { value: "input details" },
    result,
    status,
  };

  return renderToStaticMarkup(createElement(RecipeRenderer, props));
}

describe("FallbackAdapter generic tool rendering", () => {
  it("collapses uncategorized events by default", () => {
    const markup = renderFallbackEvent({ observation: "output details" });

    expect(markup).toContain('data-tool-call-name="uncategorized_tool"');
    expect(markup).not.toContain("input details");
    expect(markup).not.toContain("output details");
  });

  it("collapses uncategorized errors by default", () => {
    const markup = renderFallbackEvent(
      { error: "fallback failure details" },
      "failed"
    );

    expect(markup).not.toContain("fallback failure details");
  });
});

it("shows generated images even when tool details are collapsed", () => {
  const markup = renderFallbackEvent({
    content: [{ type: "image", mimeType: "image/png", data: "AAAA" }],
  });
  expect(markup).toContain("data:image/png;base64,AAAA");
  expect(markup).toContain("output-image-gallery");
  expect(markup).not.toContain("input details");
});

it("does not duplicate output images inside tool cards when the turn owns a gallery", () => {
  const html = renderToStaticMarkup(
    createElement(
      AgentTurnContext.Provider,
      {
        value: {
          isLastGroup: true,
          isLastItemInGroup: false,
          outputImagesAtEnd: true,
        },
      },
      createElement(RecipeRenderer, {
        event_id: "image-event",
        functionName: "generate",
        action_type: "tool_call",
        result: { images: ["data:image/png;base64,AAAA"] },
      })
    )
  );
  expect(html).not.toContain("output-image-gallery");
  expect(html).not.toContain("base64,AAAA");
});
