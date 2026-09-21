// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { type FC, type ReactNode, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeaturesSection } from "@src/modules/MainApp/Settings/subpages/EditorAppearancePage";
import { compactComposerInputAtom } from "@src/store/session/compactComposerInputAtom";
import { composerGlowVisibleAtom } from "@src/store/session/composerGlowVisibleAtom";
import { creatorComposerPositionAtom } from "@src/store/session/creatorComposerPositionAtom";
import { creatorLaunchpadActionsVisibleAtom } from "@src/store/session/creatorLaunchpadActionsVisibleAtom";
import { creatorLaunchpadSearchVisibleAtom } from "@src/store/session/creatorLaunchpadSearchVisibleAtom";
import { creatorRepoChromePositionAtom } from "@src/store/session/creatorRepoChromePositionAtom";
import { pinnedActionsVisibleAtom } from "@src/store/session/pinnedActionsVisibleAtom";
import { separateEffortPillAtom } from "@src/store/session/separateEffortPillAtom";
import {
  chatHistoryDisplayModeAtom,
  chatTokenUsageVisibleAtom,
  chatTurnMetadataVisibleAtom,
  chatTurnPaginationEnabledAtom,
  collapseToolActivityAtom,
  modelPickerStyleAtom,
} from "@src/store/ui/chatPanel/displayPrefsAtoms";
import {
  editorShowBlameAtom,
  gitSourceControlColorFileNamesAtom,
} from "@src/store/ui/editorSettingsAtom";
import { linkOpenTargetAtom } from "@src/store/ui/linkOpenTargetAtom";
import { chatPanelPositionAtom } from "@src/store/ui/workStationLayout/chatPositionAtoms";
import { workStationLayoutModeAtom } from "@src/store/ui/workStationLayout/splitLayoutAtoms";
import { diffViewModeAtom } from "@src/store/workstation/codeEditor/diffViewModeAtom";

import { AppearanceLayoutSection } from "../AppearanceLayoutSection";
import { ChatPanelAppearanceTab } from "../ChatPanelAppearanceTab";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/components/layout/Section", () => ({
  SECTION_CONTROL_STYLE: {},
  SectionContainer: ({
    title,
    children,
  }: {
    title?: string;
    children: ReactNode;
  }) => createElement("section", { "data-title": title }, children),
  SectionRow: ({ label, children }: { label?: string; children: ReactNode }) =>
    createElement("div", { "data-label": label }, children),
}));
vi.mock("@/src/components/layout/Section", () => ({
  SECTION_CONTROL_STYLE: {},
  SectionContainer: ({
    title,
    children,
  }: {
    title?: string;
    children: ReactNode;
  }) => createElement("section", { "data-title": title }, children),
  SectionRow: ({ label, children }: { label?: string; children: ReactNode }) =>
    createElement("div", { "data-label": label }, children),
}));
vi.mock("@src/components/Switch", () => ({
  default: ({
    checked,
    onCheckedChange,
    dataTestId,
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    dataTestId?: string;
  }) =>
    createElement("button", {
      "data-testid": dataTestId,
      "aria-checked": checked,
      onClick: () => onCheckedChange(!checked),
    }),
}));
vi.mock("@src/components/SegmentedTextPill", () => ({
  default: ({
    value,
    options,
    onChange,
    dataTestId,
  }: {
    value: string;
    options: { value: string }[];
    onChange: (value: string) => void;
    dataTestId?: string;
  }) =>
    createElement(
      "div",
      { "data-testid": dataTestId, "data-value": value },
      options.map((option) =>
        createElement("button", {
          key: option.value,
          "data-option": option.value,
          onClick: () => onChange(option.value),
        })
      )
    ),
}));
vi.mock("@src/components/NumberInput", () => ({ default: () => null }));
vi.mock("@src/components/Select", () => ({ default: () => null }));
vi.mock("@src/components/Input", () => ({ default: () => null }));
vi.mock("@src/components/SendOnEnterPill", () => ({ default: () => null }));
vi.mock("@src/hooks/config/useAgentConfig", () => ({
  useAgentConfig: () => ({
    chatAppearance: {
      fontSize: 14,
      codeFontSize: 13,
      lineHeight: 1.6,
      typingEffectEnabled: false,
      typingSpeed: 5,
      sendOnEnter: true,
    },
    updateChatAppearance: vi.fn(),
  }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  localStorage.clear();
});

async function renderWithStore(component: FC) {
  const store = createStore();
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () =>
    root.render(createElement(Provider, { store }, createElement(component)))
  );
  cleanup = () => act(() => root.unmount());
  const byTestId = (id: string) =>
    host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
  const clickSwitch = (id: string) => act(() => byTestId(id).click());
  const pickOption = (id: string, value: string) =>
    act(() =>
      byTestId(id)
        .querySelector<HTMLButtonElement>(`[data-option="${value}"]`)!
        .click()
    );
  return { store, host, byTestId, clickSwitch, pickOption };
}

describe("Settings → Appearance quick-menu parity", () => {
  it("App → Layout binds the sidebar Layout menu atoms", async () => {
    const { store, host, byTestId, pickOption } = await renderWithStore(
      AppearanceLayoutSection
    );
    expect(host.querySelector('[data-title="general.layout"]')).not.toBeNull();

    pickOption("chat-panel-position-select", "right");
    expect(store.get(chatPanelPositionAtom)).toBe("right");
    pickOption("workstation-sidebar-position-select", "right");
    expect(store.get(workStationLayoutModeAtom)).toBe("right");
    pickOption("model-picker-style-select", "dropdown");
    expect(store.get(modelPickerStyleAtom)).toBe("dropdown");

    // A change made from the quick menu shows up in Settings.
    act(() => store.set(workStationLayoutModeAtom, "left"));
    expect(byTestId("workstation-sidebar-position-select").dataset.value).toBe(
      "left"
    );
  });

  it("Chat Panel groups bind the session and new-chat menu atoms", async () => {
    const { store, host, byTestId, clickSwitch, pickOption } =
      await renderWithStore(ChatPanelAppearanceTab);
    for (const title of [
      "appearance.chatHistory",
      "appearance.composer",
      "appearance.newChatPage",
    ]) {
      expect(host.querySelector(`[data-title="${title}"]`)).not.toBeNull();
    }

    clickSwitch("chat-history-pagination-switch");
    expect(store.get(chatTurnPaginationEnabledAtom)).toBe(true);
    clickSwitch("chat-token-usage-switch");
    expect(store.get(chatTokenUsageVisibleAtom)).toBe(true);
    clickSwitch("chat-turn-metadata-switch");
    expect(store.get(chatTurnMetadataVisibleAtom)).toBe(false);
    clickSwitch("chat-inline-diffs-switch");
    expect(store.get(chatHistoryDisplayModeAtom)).toBe("full");
    clickSwitch("chat-collapse-tool-activity-switch");
    expect(store.get(collapseToolActivityAtom)).toBe(true);
    pickOption("chat-link-open-target-select", "external");
    expect(store.get(linkOpenTargetAtom)).toBe("external");

    const pinned = store.get(pinnedActionsVisibleAtom);
    clickSwitch("composer-pinned-skills-switch");
    expect(store.get(pinnedActionsVisibleAtom)).toBe(!pinned);
    const compact = store.get(compactComposerInputAtom);
    clickSwitch("composer-compact-input-switch");
    expect(store.get(compactComposerInputAtom)).toBe(!compact);
    const glow = store.get(composerGlowVisibleAtom);
    clickSwitch("composer-glow-switch");
    expect(store.get(composerGlowVisibleAtom)).toBe(!glow);
    const effort = store.get(separateEffortPillAtom);
    clickSwitch("composer-separate-effort-pill-switch");
    expect(store.get(separateEffortPillAtom)).toBe(!effort);

    const search = store.get(creatorLaunchpadSearchVisibleAtom);
    clickSwitch("new-chat-page-spotlight-switch");
    expect(store.get(creatorLaunchpadSearchVisibleAtom)).toBe(!search);
    const actions = store.get(creatorLaunchpadActionsVisibleAtom);
    clickSwitch("new-chat-page-quick-actions-switch");
    expect(store.get(creatorLaunchpadActionsVisibleAtom)).toBe(!actions);
    pickOption("new-chat-page-input-position-select", "middle");
    expect(store.get(creatorComposerPositionAtom)).toBe("middle");
    pickOption("new-chat-page-repo-bar-position-select", "top");
    expect(store.get(creatorRepoChromePositionAtom)).toBe("top");

    // A change made from the session menu shows up in Settings.
    act(() => store.set(collapseToolActivityAtom, false));
    expect(
      byTestId("chat-collapse-tool-activity-switch").getAttribute(
        "aria-checked"
      )
    ).toBe("false");
  });

  it("Code Editor binds diff view, git blame, and source-control colours", async () => {
    const { store, byTestId, pickOption, clickSwitch } =
      await renderWithStore(FeaturesSection);

    pickOption("diff-view-mode-select", "split");
    expect(store.get(diffViewModeAtom)).toBe("split");
    clickSwitch("git-blame-switch");
    expect(store.get(editorShowBlameAtom)).toBe(true);
    await act(async () =>
      byTestId("color-source-control-files-switch").click()
    );
    expect(store.get(gitSourceControlColorFileNamesAtom)).toBe(true);
  });
});
