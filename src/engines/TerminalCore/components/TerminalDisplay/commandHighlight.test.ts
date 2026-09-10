// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TerminalCommand } from "./TerminalCommand";
import { renderCommandHighlight } from "./commandHighlight";

const heavyHighlight = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Command previews must not load the full highlighter");
  })
);
vi.mock("@src/hooks/code/useSyntaxHighlight", () => ({
  useSyntaxHighlight: heavyHighlight,
}));

function render(text: string) {
  const element = document.createElement("div");
  element.innerHTML = renderToStaticMarkup(
    createElement(
      "span",
      { className: "prism-html" },
      renderCommandHighlight(text)
    )
  );
  return element;
}

describe("lightweight command highlighting", () => {
  it("uses existing theme token classes while preserving the exact command", () => {
    const command = "git status --short && printf '%s' $HOME";
    const element = render(command);
    expect(element.textContent).toBe(command);
    expect(element.querySelector(".token.function")?.textContent).toBe("git");
    expect(element.querySelector(".token.parameter")?.textContent).toBe(
      "--short"
    );
    expect(element.querySelector(".token.string")?.textContent).toBe("'%s'");
    expect(element.querySelector(".token.variable")?.textContent).toBe("$HOME");
    expect(element.querySelector(".token.operator")?.textContent).toBe("&&");
  });

  it("does not parse heredoc bodies as shell or turn command text into HTML", () => {
    const command = "python3 - <<'PY'\nprint('<script>bad()</script>')\nPY";
    const element = render(command);
    expect(element.textContent).toBe(command);
    expect(element.querySelector("script")).toBeNull();
    expect(
      [...element.querySelectorAll(".token")].some((token) =>
        token.textContent?.includes("print")
      )
    ).toBe(false);
  });

  it("bounds markup independently of script size without discarding text", () => {
    const command = "a;".repeat(100_000);
    const element = render(command);
    expect(element.textContent).toBe(command);
    expect(element.querySelectorAll(".token")).toHaveLength(24);
    expect(render("echo 你好 😀").textContent).toBe("echo 你好 😀");
  });

  it("uses the same renderer in the station primitive without the full highlighter", () => {
    const command = "git status --short";
    const element = document.createElement("div");
    element.innerHTML = renderToStaticMarkup(
      createElement(TerminalCommand, { command })
    );
    expect(element.querySelector(".terminal-command__text")?.innerHTML).toBe(
      render(command).firstElementChild?.innerHTML
    );
    expect(heavyHighlight).not.toHaveBeenCalled();
    element.innerHTML = renderToStaticMarkup(
      createElement(TerminalCommand, { command, highlighted: false })
    );
    expect(element.querySelector(".token")).toBeNull();
  });

  it("does not accumulate token nodes across updates or retain them after unmount", () => {
    const element = document.createElement("div");
    const root = createRoot(element);
    const environment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previous = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      for (let i = 0; i < 30; i++) {
        act(() =>
          root.render(
            createElement(TerminalCommand, {
              command: `${i};${"a;".repeat(1000)}`,
            })
          )
        );
        expect(element.querySelectorAll(".token").length).toBeLessThanOrEqual(
          24
        );
      }
      act(() => root.unmount());
      expect(element.childNodes).toHaveLength(0);
    } finally {
      environment.IS_REACT_ACT_ENVIRONMENT = previous;
    }
  });
});
