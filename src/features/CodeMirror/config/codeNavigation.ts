/**
 * CodeMirror Code Navigation Extension
 *
 * Binds the editor's code-navigation shortcuts — go to definition, find
 * references, and back/forward through visited locations — to
 * CodeNavigationService.
 *
 * These shortcuts are listed in EDITOR_SHORTCUTS and resolved through
 * `matchesShortcut`, so this extension is the dispatcher that makes them
 * customizable; without it they are advertised in Settings but do nothing.
 */
import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { matchesShortcut } from "@src/config/keyboard/shortcutBindings";
import { createLogger } from "@src/hooks/logger";

const log = createLogger("EditorCodeNavigation");

type CodeNavigationCommand =
  | "goToDefinition"
  | "findReferences"
  | "goBack"
  | "goForward";

const SHORTCUT_COMMANDS: [
  shortcutId: string,
  command: CodeNavigationCommand,
][] = [
  ["go_to_definition", "goToDefinition"],
  ["find_references", "findReferences"],
  ["go_back", "goBack"],
  ["go_forward", "goForward"],
];

/**
 * Loaded on first use so the editor bundle does not pull the navigation
 * service and its RPC layer in at startup.
 */
async function runCommand(command: CodeNavigationCommand): Promise<void> {
  const { CodeNavigationService } =
    await import("@src/services/navigation/CodeNavigationService");
  const result = await CodeNavigationService[command]();
  if (!result.ok) {
    log.info(`${command}: ${result.message}`);
  }
}

/**
 * Code navigation extension (F12, Shift+F12, Mod+[, Mod+])
 */
export function codeNavigationExtension(): Extension {
  return EditorView.domEventHandlers({
    keydown(event) {
      for (const [shortcutId, command] of SHORTCUT_COMMANDS) {
        if (matchesShortcut(event, shortcutId)) {
          event.preventDefault();
          runCommand(command).catch((error: unknown) => {
            log.error(`${command} failed:`, error);
          });
          return true;
        }
      }
      return false;
    },
  });
}
