import React from "react";

import { ConversationModePill } from "@src/features/Org2Cloud/SessionConversation/ConversationModePill";

import CliPermissionPill from "./components/CliPermissionPill";
import ModePill from "./components/ModePill";
import ModelPill from "./components/ModelPill";

interface ComposerPillsOptions {
  showAgentControls: boolean;
  teamChatActive: boolean;
  isCursorIde: boolean;
  sessionId: string | undefined;
}

export function getComposerPills({
  showAgentControls,
  teamChatActive,
  isCursorIde,
  sessionId,
}: ComposerPillsOptions) {
  // Cursor IDE sessions are read-only; no interactive model/mode pill.
  const modelPill =
    !showAgentControls ||
    teamChatActive ||
    (isCursorIde && sessionId) ? null : (
      <ModelPill />
    );
  // Always visible in-session: the composer picker is the only surface
  // that can move a session onto the Project product mode (§5.2), and a
  // hidden-at-Build pill would make that entry unreachable.
  const modePill =
    !showAgentControls || (isCursorIde && sessionId) ? null : (
      <>
        <ConversationModePill sessionId={sessionId ?? null} />
        {!teamChatActive && (
          <>
            <ModePill resetToDefaultOnClick />
            <CliPermissionPill />
          </>
        )}
      </>
    );
  return { modelPill, modePill };
}
