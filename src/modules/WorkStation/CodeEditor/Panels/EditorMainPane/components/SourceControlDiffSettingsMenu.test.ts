import { Provider, createStore } from "jotai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FileHeaderMoreMenuProps } from "@src/features/FileHeader/FileHeaderMoreMenu";
import { diffViewModeAtom } from "@src/store/workstation/codeEditor";
import type { DiffViewMode } from "@src/types/git/types";

import { SourceControlDiffSettingsMenu } from "./SourceControlDiffSettingsMenu";

const capture = vi.hoisted(() => ({
  props: null as FileHeaderMoreMenuProps | null,
}));

vi.mock("@src/features/FileHeader/FileHeaderMoreMenu", () => ({
  FileHeaderMoreMenu: (props: FileHeaderMoreMenuProps) => {
    capture.props = props;
    return null;
  },
}));

const onRefresh = vi.fn();

describe("SourceControlDiffSettingsMenu", () => {
  it("includes the shared sidebar settings submenu", () => {
    renderToStaticMarkup(
      createElement(SourceControlDiffSettingsMenu, { onRefresh })
    );

    expect(capture.props?.showSidebarSettings).toBe(true);
  });

  it("offers review search", () => {
    renderToStaticMarkup(
      createElement(SourceControlDiffSettingsMenu, { onRefresh })
    );

    expect(capture.props?.showSearchAction).toBe(true);
  });

  it("refreshes the diff list and closes the menu", () => {
    renderToStaticMarkup(
      createElement(SourceControlDiffSettingsMenu, { onRefresh })
    );

    expect(capture.props?.showReloadButton).toBe(true);
    capture.props?.onReloadClick();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  function renderInViewMode(viewMode: DiffViewMode) {
    const store = createStore();
    store.set(diffViewModeAtom, viewMode);
    renderToStaticMarkup(
      createElement(
        Provider,
        { store },
        createElement(SourceControlDiffSettingsMenu, { onRefresh })
      )
    );
  }

  it("keeps word wrap visible but locked on in split view, where panes always wrap", () => {
    renderInViewMode("split");

    expect(capture.props?.showWordWrapToggle).toBe(true);
    expect(capture.props?.wordWrapLocked).toBe(true);
  });

  it("leaves word wrap toggleable in unified view", () => {
    renderInViewMode("unified");

    expect(capture.props?.showWordWrapToggle).toBe(true);
    expect(capture.props?.wordWrapLocked).toBe(false);
  });
});
