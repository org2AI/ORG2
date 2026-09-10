import type { parseNativeSlashCommand } from "./nativeSlashCommands";
import { composerActionFor } from "./nativeSlashCommands";

type Command = NonNullable<ReturnType<typeof parseNativeSlashCommand>>;
export interface ComposerCommandActions {
  openModel: () => void;
  showStatus: () => void;
  rename: (name: string) => Promise<unknown>;
  setPlan: () => Promise<unknown>;
  dispatch: (action: string) => Promise<{ success: boolean; message?: string }>;
}

/** Undefined means this belongs to the provider. Empty text means handled
 * locally; nonempty text is the first planning turn after the mode is saved. */
export async function executeComposerCommand(
  command: Command,
  actions: ComposerCommandActions
): Promise<string | undefined> {
  const action = composerActionFor(command.name);
  if (command.name === "status") {
    if (command.args) throw new Error("Usage: /status");
    actions.showStatus();
    return "";
  }
  if (command.name === "rename") {
    if (!command.args) throw new Error("Usage: /rename <name>");
    await actions.rename(command.args);
    return "";
  }
  if (command.name === "plan") {
    await actions.setPlan();
    return command.args;
  }
  if (["model", "effort", "fast"].includes(command.name) || action) {
    if (command.args)
      throw new Error(
        `Use /${command.name} without arguments to open the ORG2 selector.`
      );
    if (["model", "effort", "fast"].includes(command.name)) actions.openModel();
    else {
      const result = await actions.dispatch(action!);
      if (!result.success)
        throw new Error(result.message || `/${command.name} failed`);
    }
    return "";
  }
  return undefined;
}
