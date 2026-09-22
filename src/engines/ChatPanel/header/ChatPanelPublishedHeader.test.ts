import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatPanelPublishedHeader } from "./ChatPanelPublishedHeader";

describe("ChatPanelPublishedHeader", () => {
  it("renders the shared 36px leading, content, and trailing slots", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ChatPanelPublishedHeader, {
        windowsHost: false,
        slots: {
          leading: React.createElement("span", null, "Leading"),
          content: React.createElement("span", null, "Content"),
          trailing: React.createElement(
            "button",
            { type: "button" },
            "Trailing"
          ),
        },
      })
    );

    expect(markup).toContain('data-testid="chat-panel-published-header"');
    expect(markup).toContain("h-9");
    expect(markup).toContain("pl-[15px]");
    expect(markup).not.toContain("border-b");
    expect(markup).not.toContain("bg-chat-pane/40");
    expect(markup).not.toContain("backdrop-blur-xl");
    expect(markup).toContain("Leading");
    expect(markup).toContain("Content");
    expect(markup).toContain("Trailing");
  });

  it("moves its reserved insets only with the transition it is given", () => {
    const renderWithInsets = (insetTransitionClassName?: string) =>
      renderToStaticMarkup(
        React.createElement(ChatPanelPublishedHeader, {
          windowsHost: false,
          slots: { content: React.createElement("span", null, "Content") },
          leadingInsetPx: 176,
          trailingInsetPx: 66,
          insetTransitionClassName,
        })
      );

    const atRest = renderWithInsets();
    expect(atRest).toContain("padding-left:176px");
    expect(atRest).toContain("padding-right:66px");
    expect(atRest).not.toContain("transition-[padding]");

    expect(renderWithInsets("transition-[padding] duration-200")).toContain(
      "transition-[padding] duration-200"
    );
  });

  it("does not add an empty row when no pane has published controls", () => {
    expect(
      renderToStaticMarkup(
        React.createElement(ChatPanelPublishedHeader, {
          slots: null,
          windowsHost: false,
        })
      )
    ).toBe("");
  });

  it("does not reserve the shared row when a split owns its header", () => {
    expect(
      renderToStaticMarkup(
        React.createElement(ChatPanelPublishedHeader, {
          slots: { hidden: true },
          windowsHost: false,
        })
      )
    ).toBe("");
  });
});
