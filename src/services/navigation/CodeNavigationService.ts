/**
 * CodeNavigationService - Code Navigation Operations
 *
 * Drives the four editor code-navigation operations shared by the command
 * surfaces (ActionSystem actions, editor keymap, the in-app agent):
 * go to definition, find references, and back / forward through visited
 * locations.
 *
 * Symbol resolution is served by the native tree-sitter scope graph behind
 * `goto_definition` / `find_references`; location history is owned by
 * NavigationHistory.
 *
 * Usage:
 *   import { CodeNavigationService } from "@src/services/navigation";
 *   await CodeNavigationService.goToDefinition();
 */
import {
  findReferences as findReferencesNative,
  gotoDefinition as gotoDefinitionNative,
} from "@src/api/tauri/search/symbol";
import type { Location } from "@src/api/tauri/search/types";
import { FileOperationsService } from "@src/services/file/FileOperationsService";
import { FileService } from "@src/services/file/FileService";
import { activeStatusBarStateAtom } from "@src/store/ui/workStationLayout/statusBarAtoms";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import {
  NavigationHistory,
  type NavigationLocation,
} from "./NavigationHistory";

/**
 * EditorService is loaded on demand: this module is reachable from the startup
 * graph through the ActionSystem registration, and EditorService pulls the
 * CodeMirror stack in with it. By the time a jump runs, the editor is mounted
 * and this resolves from cache.
 */
async function editorService() {
  const { EditorService } =
    await import("@src/services/workStation/EditorService");
  return EditorService;
}

export interface CodeNavigationResult {
  ok: boolean;
  message: string;
}

function describe(location: NavigationLocation): string {
  const name = location.filePath.split("/").pop() || location.filePath;
  return `${name}:${location.line}`;
}

function toNavigationLocation(location: Location): NavigationLocation {
  return {
    filePath: location.file_path,
    line: location.line,
    column: location.column,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The location the caret currently sits at, or null when no file is open.
 */
function currentLocation(): NavigationLocation | null {
  const filePath = FileService.getSelectedFile();
  if (!filePath) {
    return null;
  }
  let cursor: { line: number; column: number } | null = null;
  try {
    cursor = getInstrumentedStore().get(activeStatusBarStateAtom).cursor;
  } catch {
    cursor = null;
  }
  return {
    filePath,
    line: cursor?.line ?? 1,
    column: cursor?.column ?? 1,
  };
}

/**
 * Move the editor to a location.
 *
 * Within the open file the caret is placed directly, which keeps column
 * precision. Reaching another file goes through FileOperationsService.openAtLine
 * so the tab is created the same way every other jump creates it; that path
 * resolves to the start of the line, so cross-file jumps are line-precise.
 */
async function navigateTo(location: NavigationLocation): Promise<boolean> {
  if (FileService.getSelectedFile() === location.filePath) {
    const editor = await editorService();
    const moved = editor.goToPosition(location.line, location.column);
    if (moved) {
      // The cross-file path records through FileOperationsService.openAtLine;
      // a jump inside the open file has to record its own destination.
      NavigationHistory.recordVisit(location);
    }
    return moved;
  }

  const result = await FileOperationsService.openAtLine(
    location.filePath,
    location.line
  );
  return result.success;
}

/**
 * Resolve the symbol under the caret, then jump to the single location it
 * resolves to. Shared by go-to-definition and single-hit find-references.
 */
async function jumpToSingleResult(
  origin: NavigationLocation,
  target: Location,
  successLabel: string
): Promise<CodeNavigationResult> {
  const destination = toNavigationLocation(target);

  // Record where we came from so `back` has somewhere to return to; the
  // destination is recorded by the navigation itself.
  NavigationHistory.recordVisit(origin);

  const moved = await navigateTo(destination);
  if (!moved) {
    return {
      ok: false,
      message: `Could not open ${describe(destination)}`,
    };
  }

  return {
    ok: true,
    message: `${successLabel} ${describe(destination)}`,
  };
}

async function restore(
  target: NavigationLocation | null,
  emptyMessage: string,
  undo: () => void
): Promise<CodeNavigationResult> {
  if (!target) {
    return { ok: false, message: emptyMessage };
  }

  const moved = await NavigationHistory.replay(() => navigateTo(target));
  if (!moved) {
    // Leave the cursor where it was rather than drifting out of sync with
    // what the editor is actually showing.
    undo();
    return { ok: false, message: `Could not open ${describe(target)}` };
  }

  return { ok: true, message: `Moved to ${describe(target)}` };
}

export const CodeNavigationService = {
  /**
   * Go to the definition of the symbol under the caret.
   */
  async goToDefinition(): Promise<CodeNavigationResult> {
    const origin = currentLocation();
    if (!origin) {
      return { ok: false, message: "No file is open" };
    }

    let locations: Location[];
    try {
      locations = await gotoDefinitionNative(
        origin.filePath,
        origin.line,
        origin.column
      );
    } catch (error) {
      return {
        ok: false,
        message: `Go to definition failed: ${errorMessage(error)}`,
      };
    }

    const target = locations[0];
    if (!target) {
      return { ok: false, message: "No definition found under the cursor" };
    }

    return jumpToSingleResult(origin, target, "Jumped to definition at");
  },

  /**
   * Find references to the symbol under the caret.
   *
   * A single reference is a jump. Several open the search sidebar on the
   * symbol, which is the surface the editor already uses for multi-hit
   * results; the count reported is the scope graph's, not the text search's.
   */
  async findReferences(): Promise<CodeNavigationResult> {
    const origin = currentLocation();
    if (!origin) {
      return { ok: false, message: "No file is open" };
    }

    let locations: Location[];
    try {
      locations = await findReferencesNative(
        origin.filePath,
        origin.line,
        origin.column
      );
    } catch (error) {
      return {
        ok: false,
        message: `Find references failed: ${errorMessage(error)}`,
      };
    }

    if (locations.length === 0) {
      return { ok: false, message: "No references found under the cursor" };
    }

    if (locations.length === 1) {
      return jumpToSingleResult(origin, locations[0], "Jumped to reference at");
    }

    const symbol = locations[0].text;
    const { WorkStationViewService } =
      await import("@src/services/workStation/WorkStationViewService");
    await WorkStationViewService.openSearchSidebar(symbol);

    return {
      ok: true,
      message: `Found ${locations.length} references to "${symbol}"`,
    };
  },

  /**
   * Go back to the previously visited location.
   */
  async goBack(): Promise<CodeNavigationResult> {
    return restore(NavigationHistory.back(), "No previous location", () => {
      NavigationHistory.forward();
    });
  },

  /**
   * Go forward to the next visited location.
   */
  async goForward(): Promise<CodeNavigationResult> {
    return restore(NavigationHistory.forward(), "No forward location", () => {
      NavigationHistory.back();
    });
  },
};
