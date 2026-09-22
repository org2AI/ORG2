import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { CustomMentionOption } from "@src/engines/ChatPanel/hooks/useInputArea/types";
import { useSessionCommentsContext } from "@src/features/Org2Cloud/SessionComments/SessionCommentsContext";
import { buildTeamChatMentionOptions } from "@src/features/Org2Cloud/SessionConversation/teamChatMentions";

import { openedTabMentionOptionsAtom } from "../openedTabMentionOptionsAtom";

interface UseInputAreaMentionOptionsOptions {
  customMentionOptions: ReadonlyArray<CustomMentionOption> | undefined;
  teamChatActive: boolean;
}

export function useInputAreaMentionOptions({
  customMentionOptions,
  teamChatActive,
}: UseInputAreaMentionOptionsOptions) {
  const { t } = useTranslation("sessions");
  const openedTabMentionOptions = useAtomValue(openedTabMentionOptionsAtom);
  const comments = useSessionCommentsContext();
  const mentionableMembers = comments?.mentionableMembers;
  const viewerUserId = comments?.viewerUserId ?? null;
  const teamChatMentionOptions = useMemo(
    () =>
      teamChatActive && mentionableMembers
        ? buildTeamChatMentionOptions(
            mentionableMembers,
            viewerUserId,
            t("conversation.mentionGroup")
          )
        : [],
    [teamChatActive, mentionableMembers, viewerUserId, t]
  );
  const mergedCustomMentionOptions = useMemo(
    () => [
      ...openedTabMentionOptions,
      // Agent/Agent Org audience pills are a different address space from
      // Cloud members. They must not enter a Team Chat snapshot where an
      // identically-shaped id could be persisted as a human recipient.
      ...(teamChatActive ? [] : (customMentionOptions ?? [])),
      ...teamChatMentionOptions,
    ],
    [
      openedTabMentionOptions,
      customMentionOptions,
      teamChatActive,
      teamChatMentionOptions,
    ]
  );
  return mergedCustomMentionOptions;
}
