import type { useStore } from "jotai";

import Message from "@src/components/Message";
import { chatEventsAtom, eventsAtom } from "@src/engines/SessionCore";
import type { useSecretScanGuard } from "@src/hooks/security/useSecretScanGuard";
import type { useSessionCommandActions } from "@src/hooks/session/useSessionPatch";
import { zodActionRegistry } from "@src/scaffold/ActionSystem/schema/zodRegistry";
import { sessionByIdAtom } from "@src/store/session";
import { creatorDefaultExecModeAtom } from "@src/store/session/creatorDefaultExecModeAtom";
import { creatorDefaultProductModeAtom } from "@src/store/session/creatorDefaultProductModeAtom";
import { modelSelectorAtom } from "@src/store/ui/modelSelectorAtom";
import { isCliSession } from "@src/util/session/sessionDispatch";

import { parseCompactSlashCommand } from "../useManualCompact";
import { executeComposerCommand } from "./executeComposerCommand";
import { executeNativeCliCommand } from "./executeNativeCliCommand";
import { resolveMcpSlashCommand } from "./mcpSlashCommand";
import {
  isTerminalNativeSlashCommand,
  nativeSlashNames,
  parseNativeSlashCommand,
} from "./nativeSlashCommands";
import { interceptPendingQuestionBatches } from "./questionIntercept";
import type { InputAreaRefs } from "./types";

type JotaiStore = ReturnType<typeof useStore>;

export type SubmissionInterceptResult =
  | { handled: true }
  | { handled: false; displayText: string };

interface InterceptNativeSlashCommandOptions {
  store: JotaiStore;
  draftSessionId: string;
  provider: Parameters<typeof isTerminalNativeSlashCommand>[0];
  displayText: string;
  submitDisabled: boolean;
  isExplicitAction: boolean;
  composerInputRef: InputAreaRefs["composerInputRef"];
  flushDraft: (text: string) => Promise<void>;
  guardAgainstSecrets: ReturnType<typeof useSecretScanGuard>;
  setPlan: ReturnType<typeof useSessionCommandActions>["setPlan"];
  rename: ReturnType<typeof useSessionCommandActions>["rename"];
  onSubmitted: (() => void) | undefined;
}

/**
 * Native slash-command path (`/plan`, `/model`, `/compact` pills on native
 * providers, ...). Returns `handled: true` when the submission was fully
 * consumed (or aborted) here; otherwise the possibly-rewritten display text
 * continues down the ordinary dispatch pipeline.
 */
export async function interceptNativeSlashCommand({
  store,
  draftSessionId,
  provider,
  displayText,
  submitDisabled,
  isExplicitAction,
  composerInputRef,
  flushDraft,
  guardAgainstSecrets,
  setPlan,
  rename,
  onSubmitted,
}: InterceptNativeSlashCommandOptions): Promise<SubmissionInterceptResult> {
  // Older pinned Compact actions serialize as an ORG2 skill pill.
  // Normalize that explicit command before choosing the native path.
  const compact =
    provider === "codex" || provider === "claude_code"
      ? parseCompactSlashCommand(displayText)
      : null;
  const nativeCommandText = compact
    ? `/compact${compact.instructions ? ` ${compact.instructions}` : ""}`
    : displayText;
  const command = parseNativeSlashCommand(nativeCommandText);
  if (command) {
    if (command.name === "plan" && submitDisabled) return { handled: true };
    try {
      const remaining = await executeComposerCommand(command, {
        showStatus: () => {
          const session = store.get(sessionByIdAtom(draftSessionId));
          Message.info(
            [
              session?.name,
              session?.model,
              session?.agentExecMode,
              session?.repoPath,
            ]
              .filter(Boolean)
              .join(" · ")
          );
        },
        openModel: () => store.set(modelSelectorAtom, { isOpen: true }),
        setPlan: () =>
          draftSessionId
            ? setPlan()
            : Promise.resolve().then(() => {
                store.set(creatorDefaultExecModeAtom, "plan");
                store.set(creatorDefaultProductModeAtom, null);
              }),
        rename,
        dispatch: (action) => zodActionRegistry.execute(action, {}),
      });
      if (
        remaining === undefined &&
        isCliSession(draftSessionId) &&
        isTerminalNativeSlashCommand(
          provider,
          draftSessionId,
          store.get(eventsAtom),
          command.name
        )
      ) {
        throw new Error(
          `/${command.name} requires the native terminal and is unavailable through the provider SDK. Your draft has been kept.`
        );
      }
      if (
        remaining === undefined &&
        isCliSession(draftSessionId) &&
        nativeSlashNames(
          provider,
          draftSessionId,
          store.get(eventsAtom)
        ).includes(command.name)
      ) {
        if (submitDisabled || !(await guardAgainstSecrets(displayText)))
          return { handled: true };
        await executeNativeCliCommand(draftSessionId, nativeCommandText);
        if (!isExplicitAction) {
          composerInputRef.current?.clear();
          await flushDraft("");
        }
        onSubmitted?.();
        return { handled: true };
      }
      if (remaining !== undefined) {
        if (!remaining) {
          if (!isExplicitAction) {
            composerInputRef.current?.clear();
            await flushDraft("");
          }
          onSubmitted?.();
          return { handled: true };
        }
        displayText = remaining;
      }
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
      return { handled: true };
    }
  }
  return { handled: false, displayText };
}

interface ApplySubmissionInterceptorsOptions {
  store: JotaiStore;
  draftSessionId: string;
  displayText: string;
  hasText: boolean;
  enableAgentInterceptors: boolean;
  guardAgainstSecrets: ReturnType<typeof useSecretScanGuard>;
  skippedByUserLabel: () => string;
}

/**
 * Pre-dispatch gates that run on ordinary messages: secret scan, pending
 * question intercept, and MCP slash-prompt expansion. Returns `handled: true`
 * when the submission must stop here.
 */
export async function applySubmissionInterceptors({
  store,
  draftSessionId,
  displayText,
  hasText,
  enableAgentInterceptors,
  guardAgainstSecrets,
  skippedByUserLabel,
}: ApplySubmissionInterceptorsOptions): Promise<SubmissionInterceptResult> {
  // ── Secret scan gate ─────────────────────────────────────────────────
  // Warn before a typed API key / token / password enters the transcript
  // and reaches the model. The user can still choose to send anyway.
  if (hasText) {
    const clearedSecretScan = await guardAgainstSecrets(displayText);
    if (!clearedSecretScan) return { handled: true };
  }

  // ── Question intercept ────────────────────────────────────────────────
  // When the agent asked a question and the user typed a reply in the main
  // input, forward the typed text as the question answer before dispatching.
  // Finalizes locally even when the native commands fail (no CLI bridge) —
  // see questionIntercept.ts.
  if (enableAgentInterceptors && hasText && draftSessionId) {
    interceptPendingQuestionBatches(
      store.get(chatEventsAtom),
      draftSessionId,
      displayText.trim(),
      skippedByUserLabel()
    );
  }

  // ── MCP slash-command resolution ─────────────────────────────────────
  if (enableAgentInterceptors) {
    try {
      const rendered = await resolveMcpSlashCommand(displayText.trim());
      if (rendered !== null) {
        displayText = rendered;
      }
    } catch (err) {
      Message.error(
        `MCP prompt failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return { handled: true };
    }
  }

  return { handled: false, displayText };
}
