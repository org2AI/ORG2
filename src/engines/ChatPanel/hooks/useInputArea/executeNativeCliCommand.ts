import { getTurnPhase } from "@src/engines/SessionCore/control/turnLifecycle";
import { dispatchUserIntent } from "@src/engines/SessionCore/services/userIntentDispatch";

/** Protocol controls may complete without a native user-message echo. Use the
 * existing transport/lifecycle owner, not conversation-tail recovery (which
 * correctly requires that echo for ordinary messages). Never overlap a turn. */
export async function executeNativeCliCommand(
  sessionId: string,
  text: string
): Promise<void> {
  if (getTurnPhase(sessionId) !== "idle") {
    throw new Error(
      "Wait for the current turn to finish before running a native command."
    );
  }
  await dispatchUserIntent({
    sessionId,
    visibleText: text,
    send: {
      content: text,
      turnIntentId: crypto.randomUUID(),
      turnIntentSource: "user_submit",
    },
  });
}
