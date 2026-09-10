import { type MutableRefObject, useEffect } from "react";

import {
  getOverride,
  isRecordingShortcut,
  matchesShortcut,
} from "@src/config/keyboard/shortcutBindings";
import { shortcutRegistry } from "@src/hooks/keyboard";
import { devModeEnabledAtom } from "@src/store/platform/devModeAtom";
import { routeDebugModalOpenAtom } from "@src/store/ui/uiAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { resolveDigitZeroShortcut } from "./digitZeroShortcut";
import { isEditableElement, isEditableElementExtended } from "./types";

function selectActiveTextControl(): boolean {
  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement
  ) {
    activeElement.select();
    return true;
  }
  return false;
}

function isTerminalShortcutTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.closest(".terminal-core") !== null ||
      target.closest(".xterm") !== null ||
      target.closest(".xterm-terminal-container") !== null)
  );
}

function handleSelectAllShortcut() {
  const terminalEl = document.querySelector(".terminal-core");
  if (
    terminalEl?.contains(document.activeElement) ||
    terminalEl === document.activeElement
  ) {
    window.dispatchEvent(new CustomEvent("terminal-select-all"));
    return;
  }

  if (!selectActiveTextControl()) {
    document.execCommand("selectAll");
  }
}

interface UseGlobalKeydownShortcutsOptions {
  inspectModeRef: MutableRefObject<boolean>;
  handleInspectMoveUpLevel: () => Promise<boolean | undefined>;
  handleInspectMoveDownLevel: () => Promise<boolean | undefined>;
  handleInspectToggleLabels: () => Promise<boolean>;
  handleInspectHideLabels: () => Promise<boolean>;
  spotlightOpenRef: MutableRefObject<boolean>;
  handleOpenWorkStationFilePalette: () => void;
  handleOpenWorkStationSymbolPalette: () => void;
  handleOpenAgentSessionSearch: () => void;
  handleOpenSettings: () => void;
  handleToggleSidebar: () => void;
  handleToggleWorkstationSidebar: () => void;
  handleOpenCodeEditorFileFolder: () => void;
  handleOpenCodeEditorSourceControl: () => void;
  handleOpenCodeEditorSearchSidebar: () => void;
  handleOpenCodeEditorTerminal: () => void;
  handleCloseCurrentTab: () => boolean;
  handleToggleWorkStationChatFocus: () => void;
  openQuitConfirmation: () => void;
  closeQuitConfirmation: () => void;
}

export function useGlobalKeydownShortcuts(
  options: UseGlobalKeydownShortcutsOptions
) {
  const {
    inspectModeRef,
    handleInspectMoveUpLevel,
    handleInspectMoveDownLevel,
    handleInspectToggleLabels,
    handleInspectHideLabels,
    spotlightOpenRef,
    handleOpenWorkStationFilePalette,
    handleOpenWorkStationSymbolPalette,
    handleOpenAgentSessionSearch,
    handleOpenSettings,
    handleToggleSidebar,
    handleToggleWorkstationSidebar,
    handleOpenCodeEditorFileFolder,
    handleOpenCodeEditorSourceControl,
    handleOpenCodeEditorSearchSidebar,
    handleOpenCodeEditorTerminal,
    handleCloseCurrentTab,
    handleToggleWorkStationChatFocus,
    openQuitConfirmation,
    closeQuitConfirmation,
  } = options;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || isRecordingShortcut()) return;

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const modifierKey = isMac ? event.metaKey : event.ctrlKey;

      if (
        event.key === "Tab" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        inspectModeRef.current
      ) {
        const target = event.target;
        if (!isEditableElement(target)) {
          event.preventDefault();
          event.stopPropagation();
          if (event.shiftKey) {
            handleInspectMoveDownLevel();
          } else {
            handleInspectMoveUpLevel();
          }
          return;
        }
      }

      if (
        (event.key.toLowerCase() === "h" || event.key.toLowerCase() === "x") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        inspectModeRef.current
      ) {
        const target = event.target;
        if (!isEditableElement(target)) {
          event.preventDefault();
          event.stopPropagation();
          if (event.key.toLowerCase() === "x") {
            handleInspectHideLabels();
          } else {
            handleInspectToggleLabels();
          }
          return;
        }
      }

      if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !/^F\d+$/.test(event.key)
      ) {
        if (
          event.key === "Backspace" &&
          !isEditableElementExtended(event.target)
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      const editable = isEditableElementExtended(event.target);
      const workstation =
        window.location.pathname.startsWith("/orgii/workstation");
      const editorTarget =
        event.target instanceof Element && !!event.target.closest(".cm-editor");
      const actions: [string, () => unknown, boolean?][] = [
        ["quit_app", openQuitConfirmation],
        ["next_tab", () => shortcutRegistry.dispatch("next_tab")],
        ["previous_tab", () => shortcutRegistry.dispatch("previous_tab")],
        ["maximize_chat", handleToggleWorkStationChatFocus, workstation],
        [
          "toggle_ade_manager",
          () => shortcutRegistry.dispatch("toggle_ade_manager"),
        ],
        ["toggle_workstation_sidebar", handleToggleWorkstationSidebar],
        ["toggle_sidebar", handleToggleSidebar, !editable],
        [
          "open_file_folder_tab",
          handleOpenCodeEditorFileFolder,
          workstation && (!editable || isTerminalShortcutTarget(event.target)),
        ],
        [
          "open_source_control_tab",
          handleOpenCodeEditorSourceControl,
          workstation && (!editable || isTerminalShortcutTarget(event.target)),
        ],
        [
          "open_terminal_tab",
          handleOpenCodeEditorTerminal,
          workstation && (!editable || isTerminalShortcutTarget(event.target)),
        ],
        ["open_my_station", () => shortcutRegistry.dispatch("open_my_station")],
        [
          "open_agent_station",
          () => shortcutRegistry.dispatch("open_agent_station"),
        ],
        ["open_kanban", () => shortcutRegistry.dispatch("open_kanban")],
        ["close_tab", handleCloseCurrentTab],
        [
          "hide_window",
          () => shortcutRegistry.dispatch("hide_window"),
          !(event.ctrlKey && !event.metaKey && editable),
        ],
        [
          "maximize_work_station",
          () => shortcutRegistry.dispatch("maximize_work_station"),
        ],
        ["new_session", () => shortcutRegistry.dispatch("new_session")],
        ["new_tab", () => shortcutRegistry.dispatch("new_tab")],
        ["new_tab_alt", () => shortcutRegistry.dispatch("new_tab_alt")],
        ["open_settings", handleOpenSettings],
        [
          "agent_session_search",
          handleOpenAgentSessionSearch,
          spotlightOpenRef.current || !editable,
        ],
        [
          "toggle_inspect_mode",
          () => shortcutRegistry.dispatch("toggle_inspect_mode"),
        ],
        [
          "capture_component",
          () => shortcutRegistry.dispatch("capture_component"),
        ],
        [
          "toggle_api_panel",
          () => shortcutRegistry.dispatch("toggle_api_panel"),
        ],
        ["zoom_in", () => shortcutRegistry.dispatch("zoom_in")],
        ["zoom_out", () => shortcutRegistry.dispatch("zoom_out")],
        ["zoom_reset", () => shortcutRegistry.dispatch("zoom_reset")],
        [
          "open_model_selector",
          () => shortcutRegistry.dispatch("open_model_selector"),
          !editorTarget,
        ],
        [
          "open_workspace_selector",
          () => shortcutRegistry.dispatch("open_workspace_selector"),
        ],
        [
          "open_branch_selector",
          () => shortcutRegistry.dispatch("open_branch_selector"),
        ],
        [
          "open_location_selector",
          () => shortcutRegistry.dispatch("open_location_selector"),
        ],
        ["go_to_symbol", handleOpenWorkStationSymbolPalette, workstation],
        ["quick_open", handleOpenWorkStationFilePalette, workstation],
        [
          "toggle_spotlight",
          () => shortcutRegistry.dispatch("toggle_spotlight"),
          spotlightOpenRef.current || !editable,
        ],
        ["search_files", handleOpenCodeEditorSearchSidebar],
        [
          "window_close",
          () => {
            void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
              getCurrentWindow().close()
            );
          },
        ],
        [
          "window_open_folder",
          () => {
            void import("@tauri-apps/api/event").then(({ emit }) =>
              emit("menu-file-open-folder")
            );
          },
        ],
      ];
      const action = actions.find(
        ([id, , enabled]) => enabled !== false && matchesShortcut(event, id)
      );
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        action[1]();
        return;
      }

      if (event.key === "Backspace") {
        const target = event.target;
        if (!isEditableElementExtended(target)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      // Keep non-configurable native editing and the developer inspector scoped
      // separately from user command bindings.
      if (!modifierKey) return;
      if (event.code === "Digit0") {
        const target = resolveDigitZeroShortcut(event);
        if (target === "route_debug_modal") {
          event.preventDefault();
          const store = getInstrumentedStore();
          if (store.get(devModeEnabledAtom))
            store.set(routeDebugModalOpenAtom, (prev) => !prev);
        } else if (target === "zoom_reset" && !getOverride("zoom_reset")) {
          event.preventDefault();
          shortcutRegistry.dispatch("zoom_reset");
        }
        return;
      }
      if (event.key.toLowerCase() === "a" && !event.shiftKey && !event.altKey) {
        if (editable && !isTerminalShortcutTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        handleSelectAllShortcut();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      closeQuitConfirmation();
    };
  }, [
    handleInspectMoveUpLevel,
    handleInspectMoveDownLevel,
    handleInspectToggleLabels,
    handleInspectHideLabels,
    inspectModeRef,
    spotlightOpenRef,
    handleOpenWorkStationFilePalette,
    handleOpenWorkStationSymbolPalette,
    handleOpenAgentSessionSearch,
    handleOpenSettings,
    handleToggleSidebar,
    handleToggleWorkstationSidebar,
    handleOpenCodeEditorFileFolder,
    handleOpenCodeEditorSourceControl,
    handleOpenCodeEditorSearchSidebar,
    handleOpenCodeEditorTerminal,
    handleCloseCurrentTab,
    handleToggleWorkStationChatFocus,
    openQuitConfirmation,
    closeQuitConfirmation,
  ]);
}
