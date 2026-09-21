import { useEffect, useRef, useState } from "react";

import { projectApi } from "@src/api/http/project";
import type { DiscussionTriggerPreview } from "@src/api/http/project";
import { createLogger } from "@src/hooks/logger";
import { useDebouncedCallback } from "@src/hooks/perf";
import type { Person } from "@src/types/core/shared";

import {
  type MentionCandidate,
  normalizeWorkItemMentions,
} from "../workItemMentions";

const logger = createLogger("useWorkItemContentState");

interface UseWorkItemDiscussionTriggerPreviewOptions {
  commentText: string;
  replyToCommentId: string | null;
  mentionRefs: string[];
  scopedShortId: string;
  projectSlug?: string | null;
  orgId?: string | null;
  currentUser: Person;
  teamMembers: Person[];
  availableAgents: MentionCandidate[];
  availableOrgs: MentionCandidate[];
}

/**
 * Debounced preview of what the Discussion draft would trigger, re-requested
 * whenever the draft, its mentions or its reply target change. Stale
 * responses are dropped by generation.
 */
export function useWorkItemDiscussionTriggerPreview({
  commentText,
  replyToCommentId,
  mentionRefs,
  scopedShortId,
  projectSlug,
  orgId,
  currentUser,
  teamMembers,
  availableAgents,
  availableOrgs,
}: UseWorkItemDiscussionTriggerPreviewOptions) {
  const [triggerPreview, setTriggerPreview] =
    useState<DiscussionTriggerPreview | null>(null);
  const previewGenerationRef = useRef(0);

  const fetchTriggerPreview = useDebouncedCallback((content: string) => {
    const generation = previewGenerationRef.current + 1;
    previewGenerationRef.current = generation;
    projectApi
      .previewDiscussionTrigger({
        projectSlug: projectSlug ?? null,
        orgId: orgId || "personal-org",
        workItemId: scopedShortId,
        content,
        mentions: normalizeWorkItemMentions(mentionRefs, {
          members: teamMembers,
          agents: availableAgents,
          agentOrgs: availableOrgs,
          currentUserId: currentUser.id,
        }),
        parentId: replyToCommentId,
      })
      .then((preview) => {
        if (previewGenerationRef.current === generation) {
          setTriggerPreview(preview);
        }
      })
      .catch((error) => {
        logger.warn("Failed to preview Discussion trigger", error);
        if (previewGenerationRef.current === generation) {
          setTriggerPreview(null);
        }
      });
  }, 350);

  useEffect(() => {
    const content = commentText.trim();
    if (!scopedShortId || !content) {
      previewGenerationRef.current += 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- an emptied draft must drop the stale preview at once; the generation bump discards in-flight responses
      setTriggerPreview(null);
      return;
    }
    fetchTriggerPreview(content);
  }, [
    commentText,
    fetchTriggerPreview,
    scopedShortId,
    mentionRefs,
    replyToCommentId,
  ]);

  return triggerPreview;
}
