/** Central native context-menu lifecycle for the current WebView. */
import { invoke } from "@tauri-apps/api/core";
import {
  type LogicalPosition,
  type PhysicalPosition,
  Position,
} from "@tauri-apps/api/dpi";
import {
  type CheckMenuItemOptions,
  type IconMenuItemOptions,
  Menu,
  type MenuItemOptions,
  type PredefinedMenuItemOptions,
  type SubmenuOptions,
} from "@tauri-apps/api/menu";

/**
 * Plain menu options accepted by Tauri's `Menu.new({ items })` API.
 *
 * Callers deliberately provide options instead of creating menu resources.
 * This keeps every native-menu IPC call and resource lifetime in this module.
 */
export type NativeMenuItemOptions =
  | MenuItemOptions
  | PredefinedMenuItemOptions
  | CheckMenuItemOptions
  | IconMenuItemOptions
  | SubmenuOptions;

export interface NativeMenuPopupBusy {
  status: "busy";
  activeSource: string;
}

export interface NativeMenuPopupEmpty {
  status: "empty";
}

export interface NativeMenuPopupClosed {
  status: "closed";
}

export type NativeMenuPopupResult =
  | NativeMenuPopupBusy
  | NativeMenuPopupEmpty
  | NativeMenuPopupClosed;

export interface PopupNativeMenuOptions {
  /** Stable diagnostic name for the UI surface requesting the menu. */
  source: string;
  /**
   * Builds a fresh options array after this request owns the popup gate.
   * Tauri mutates action-bearing option objects while serializing them.
   */
  buildItems: () => NativeMenuItemOptions[] | Promise<NativeMenuItemOptions[]>;
  /** Optional position relative to the current window. */
  at?: LogicalPosition | PhysicalPosition | Position;
  /** Retry at the current cursor if a positioned popup is unsupported. */
  fallbackToCursor?: boolean;
  /** Called when another native menu already owns the popup lifecycle. */
  onBusy?: (activeSource: string) => void;
}

interface ActiveNativeMenuPopup {
  source: string;
  token: object;
}

interface NativeMenuPopupState {
  active: ActiveNativeMenuPopup | null;
}

const NATIVE_MENU_STATE_KEY = Symbol.for("orgii.tauri.native-menu-popup.v2");

function getState(): NativeMenuPopupState {
  const host = globalThis as unknown as Record<symbol, unknown>;
  const existing = host[NATIVE_MENU_STATE_KEY];
  if (existing) return existing as NativeMenuPopupState;

  const state: NativeMenuPopupState = { active: null };
  host[NATIVE_MENU_STATE_KEY] = state;
  return state;
}

/**
 * Owns the complete lifecycle of one native context menu.
 *
 * The backend popup command releases the WebView resource lock before native
 * tracking so reentrant filesystem/resource IPC cannot deadlock AppKit.
 * This gate additionally prevents overlapping native menu tracking sessions.
 * Duplicate requests are dropped because replaying a context menu after the
 * originating interaction has ended would be stale UI.
 */
export async function popupNativeMenu({
  source,
  buildItems,
  at,
  fallbackToCursor = false,
  onBusy,
}: PopupNativeMenuOptions): Promise<NativeMenuPopupResult> {
  const state = getState();
  if (state.active) {
    onBusy?.(state.active.source);
    return { status: "busy", activeSource: state.active.source };
  }

  const token = {};
  state.active = { source, token };

  try {
    const items = await buildItems();
    if (items.length === 0) return { status: "empty" };

    const menu = await Menu.new({ items });
    let popupError: unknown;
    try {
      if (at) {
        try {
          await invoke("popup_native_menu", {
            rid: menu.rid,
            at: at instanceof Position ? at : new Position(at),
          });
        } catch (error) {
          if (!fallbackToCursor) throw error;
          await invoke("popup_native_menu", { rid: menu.rid });
        }
      } else {
        await invoke("popup_native_menu", { rid: menu.rid });
      }
    } catch (error) {
      popupError = error;
    }

    let closeError: unknown;
    try {
      await menu.close();
    } catch (error) {
      closeError = error;
    }

    if (popupError !== undefined && closeError !== undefined) {
      throw Object.assign(
        new Error("Native menu popup and cleanup both failed"),
        { errors: [popupError, closeError] }
      );
    }
    if (popupError !== undefined) throw popupError;
    if (closeError !== undefined) throw closeError;

    return { status: "closed" };
  } finally {
    if (state.active?.token === token) {
      state.active = null;
    }
  }
}
