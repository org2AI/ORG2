import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  buildSettingsPath,
  parseSettingsSectionTab,
} from "@src/config/mainAppPaths";
import { getSettingsSectionsByTab } from "@src/config/settingsUiManifest";

import SettingsSectionRenderer from "./SettingsSectionRenderer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Keep the real manifest, registry, and dispatch boundary. Replace only the
// leaf pages, whose independent IPC/state behavior is outside this test.
vi.mock("../sections/GeneralSection", () => ({
  default: ({ activeTab }: { activeTab?: string }) => `general:${activeTab}`,
}));
vi.mock("../sections/AppearanceSection", () => ({
  default: ({ activeTab }: { activeTab?: string }) => `appearance:${activeTab}`,
}));
vi.mock("../sections/EditorSection", () => ({
  default: () => "editor-content",
}));
vi.mock("../sections/SecuritySection", () => ({
  default: () => "security-content",
}));
vi.mock("../sections/MobileRemoteSettingsSection", () => ({
  default: () => "mobile-content",
}));
vi.mock("../sections/HarnessConnections/HarnessConnectionsSection", () => ({
  default: () => "harness-content",
}));

describe("SettingsSectionRenderer", () => {
  it.each([
    ["general", "notifications", "general:notifications"],
    ["appearance", "code-editor", "appearance:code-editor"],
    ["editor", "editor", "editor-content"],
    ["security", undefined, "security-content"],
    ["mobile-remote", undefined, "mobile-content"],
    ["harness-connections", undefined, "harness-content"],
  ] as const)(
    "renders the live %s section from its route",
    (section, tab, content) => {
      const route = parseSettingsSectionTab(
        buildSettingsPath({ section, tab })
      );
      const html = renderToStaticMarkup(
        createElement(SettingsSectionRenderer, {
          sectionId: route.section!,
          activeTab: route.tab ?? undefined,
        })
      );
      expect(html).toContain(`id="${section}"`);
      expect(html).toContain(content);
      expect(html).not.toContain("section renderer is not configured");
    }
  );

  it("keeps every app section represented by a live slot", () => {
    expect(getSettingsSectionsByTab("app").map(({ id }) => id)).toEqual([
      "general",
      "appearance",
      "editor",
      "security",
      "mobile-remote",
      "harness-connections",
    ]);
  });

  it("keeps unknown sections empty", () => {
    expect(
      renderToStaticMarkup(
        createElement(SettingsSectionRenderer, {
          sectionId: "unknown-section",
        })
      )
    ).toBe("");
  });
});
