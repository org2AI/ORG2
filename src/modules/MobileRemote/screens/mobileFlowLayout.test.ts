import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MobileShell } from "../components/MobileShell";
import { ConnectingScreen } from "./ConnectingScreen";
import { ConnectionErrorScreen } from "./ConnectionErrorScreen";
import { SASConfirmScreen } from "./SASConfirmScreen";
import { WelcomeScreen } from "./WelcomeScreen";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("mobile flow scroll ownership", () => {
  it.each([
    ["welcome", React.createElement(WelcomeScreen)],
    ["connecting", React.createElement(ConnectingScreen)],
    [
      "error",
      React.createElement(ConnectionErrorScreen, {
        onRetry: vi.fn(),
        onRepair: vi.fn(),
      }),
    ],
    [
      "verification",
      React.createElement(SASConfirmScreen, {
        phrase: "LongVerificationPhrase".repeat(8),
      }),
    ],
  ])(
    "keeps %s content in a bounded scroll region inside the shell",
    (_name, screen) => {
      const html = renderToStaticMarkup(
        React.createElement(MobileShell, null, screen)
      );
      expect(html).toContain("mobile-shell__viewport");
      expect(html).toContain("mobile-flow-screen");
    }
  );
});
