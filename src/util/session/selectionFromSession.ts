/**
 * selectionFromSession — shared utility
 *
 * Projects a live session row + creator-default fallback into the
 * `LastModelSelection` shape that dispatchers consume.
 *
 * Previously duplicated in:
 *  - src/engines/SessionCore/hooks/session/useQueueDispatch.ts
 *  - src/engines/ChatPanel/hooks/useWorkspaceChat/useMessageDispatch.ts
 */
import { isHostedKey } from "@src/api/tauri/session";
import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";
import type { Session } from "@src/store/session/sessionAtom/types";

export function selectionFromSession(
  session: Session | undefined,
  fallback: LastModelSelection | null
): LastModelSelection | null {
  // A model/source pair is one identity. Never fill an existing session's
  // missing account or routing fields from an unrelated creator preference.
  if (!session?.model) return fallback;

  const keySource = session.keySource;
  // Rust persists market sessions with `listingModel` written into
  // `code_sessions.model`, so we can read either as the market `model`
  // identifier without a separate column.
  const isHosted = isHostedKey(keySource);

  return {
    keySource,
    model: isHosted ? undefined : session.model,
    listingModel: isHosted ? session.model : undefined,
    selectedAccountId: session.accountId,
    cliAgentType: session.cliAgentType,
    tier: session.tier,
    credentialSource: session.credentialSource,
  };
}
