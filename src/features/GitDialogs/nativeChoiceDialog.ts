/**
 * Shared native choice dialog for the git flows.
 *
 * Every dialog in this directory was the same shape: build a message, hand
 * `message()` one or two affirmative buttons plus Cancel, then map the answer
 * back to a semantic result.
 *
 * The mapping is the part worth centralising. `MessageDialogResult::Custom` is
 * `#[serde(untagged)]` on the Rust side, so a custom button comes back as its
 * own *label text* — the dialogs used to compare that against an English
 * literal (`result === "Create Pull Request"`). That only worked while the
 * labels were hardcoded English; translating them would have silently turned
 * every affirmative answer into "cancel". Here the labels are built once and
 * the answer is matched against those same strings, so no literal is ever
 * compared and the labels are free to be localized.
 */
import i18n from "@src/i18n";

export interface NativeChoice<Id extends string> {
  /** Semantic result returned to the caller. */
  id: Id;
  /** Button text, already translated. */
  label: string;
}

export interface NativeChoiceDialogParams<Id extends string> {
  title: string;
  message: string;
  kind?: "info" | "warning" | "error";
  /**
   * One or two affirmative buttons. Tauri maps one to `{ ok, cancel }` and two
   * to `{ yes, no, cancel }`; the order here is the order shown.
   */
  choices:
    | readonly [NativeChoice<Id>]
    | readonly [NativeChoice<Id>, NativeChoice<Id>];
  /** Cancel button text. Defaults to the shared `common:actions.cancel`. */
  cancelLabel?: string;
}

/**
 * Shows the dialog and resolves to the chosen `id`, or `"cancel"` when the
 * user cancels or dismisses it.
 */
export async function openNativeChoiceDialog<Id extends string>({
  title,
  message: body,
  kind = "warning",
  choices,
  cancelLabel,
}: NativeChoiceDialogParams<Id>): Promise<Id | "cancel"> {
  const { message } = await import("@tauri-apps/plugin-dialog");
  const cancel = cancelLabel ?? i18n.t("common:actions.cancel");

  const buttons =
    choices.length === 2
      ? { yes: choices[0].label, no: choices[1].label, cancel }
      : { ok: choices[0].label, cancel };

  const result = await message(body, { title, kind, buttons });

  // Identity match against the labels we just built — never a literal.
  return choices.find((choice) => choice.label === result)?.id ?? "cancel";
}
