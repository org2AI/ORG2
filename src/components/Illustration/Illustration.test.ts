// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { compile } from "sass";
import { expect, it } from "vitest";

import Illustration from "./index";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("keeps explicit light/dark previews independent of the ancestor app theme", async () => {
  const stylesheet = document.createElement("style");
  stylesheet.textContent = compile(
    "src/components/Illustration/index.scss"
  ).css;
  document.head.append(stylesheet);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(Illustration, { src: "/art.png", theme: "light" }),
          createElement(Illustration, { src: "/art.png", theme: "dark" }),
          createElement(Illustration, { src: "/art.png" })
        )
      )
    );
    for (const theme of ["light", "dark", "light"]) {
      host.dataset.theme = theme;
      const [light, dark, automatic] = Array.from(host.querySelectorAll("img"));
      expect(getComputedStyle(light).filter).toBe("none");
      expect(getComputedStyle(light).mixBlendMode).toBe("multiply");
      expect(getComputedStyle(dark).filter).toBe(
        "brightness(0.96) contrast(0.8)"
      );
      expect(getComputedStyle(dark).mixBlendMode).toBe("normal");
      expect(getComputedStyle(automatic).filter).toBe(
        theme === "dark" ? "brightness(0.96) contrast(0.8)" : "none"
      );
    }
  } finally {
    await act(async () => root.unmount());
    host.remove();
    stylesheet.remove();
  }
});
