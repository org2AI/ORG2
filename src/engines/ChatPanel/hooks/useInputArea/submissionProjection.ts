import type {
  ComposerInputRef,
  ComposerSnapshot,
} from "@src/components/ComposerInput";
import { prependQuotedSelection } from "@src/engines/ChatPanel/chatSelections/quotedReply";
import type { ChatImageAttachment } from "@src/store/ui/chatImageAtom";
import { isCliSession } from "@src/util/session/sessionDispatch";

import { projectOutgoingUserMessage } from "./projectOutgoingUserMessage";
import {
  memberMentionsFromSnapshot,
  serializeSubmissionSnapshot,
} from "./submissionSnapshot";

function lastSerializedPillLabel(rawLabel: string): string {
  const trimmed = rawLabel.trim();
  const lastSpaceIdx = trimmed.search(/\s[^\s]*$/);
  return lastSpaceIdx >= 0 ? trimmed.slice(lastSpaceIdx + 1).trim() : trimmed;
}

interface BuildSubmissionContextBlocksOptions {
  /** Text scanned for `[session:<id>]` pills (skill-expanded when present). */
  scanText: string;
  terminalTexts: ReturnType<ComposerInputRef["getTerminalPillTexts"]>;
  resolveSessionName: (sessionId: string) => string | null | undefined;
}

export function buildSubmissionContextBlocks({
  scanText,
  terminalTexts,
  resolveSessionName,
}: BuildSubmissionContextBlocksOptions): string[] {
  // ── Session pill ID injection ─────────────────────────────────────────
  // Session pills carry only the session ID (no transcript). Extract them
  // from the serialized display text and append lightweight references.
  const sessionPillPattern = /([^\n[]+?)\s*\[session:([^\]]+)\]/g;
  const sessionRefs: string[] = [];
  let sessionMatch: RegExpExecArray | null;
  while ((sessionMatch = sessionPillPattern.exec(scanText)) !== null) {
    const referencedSessionId = sessionMatch[2];
    const referencedSessionName = resolveSessionName(referencedSessionId);
    const fallbackLabel = lastSerializedPillLabel(sessionMatch[1]);
    const label = referencedSessionName?.trim() || fallbackLabel;
    sessionRefs.push(`[Session Reference: ${label} (${referencedSessionId})]`);
  }

  // ── Terminal/PR pill text collection ─────────────────────────────────
  const terminalEntries = Object.entries(terminalTexts);
  const contextBlocks: string[] = [];

  if (terminalEntries.length > 0) {
    for (const [path, text] of terminalEntries) {
      if (path.startsWith("pr://")) {
        try {
          const prData = JSON.parse(text) as Record<string, unknown>;
          const lines: string[] = [
            `[PR Context] #${prData["prNumber"] ?? prData["number"]} ${prData["prTitle"] ?? prData["title"]}`,
            `Status: ${prData["prStatus"] ?? prData["state"]}`,
            ...(prData["sourceBranch"]
              ? [
                  `Branch: ${prData["sourceBranch"]}${prData["targetBranch"] ? ` → ${prData["targetBranch"]}` : ""}`,
                ]
              : []),
            ...(prData["additions"] != null
              ? [`+${prData["additions"]} -${prData["deletions"] ?? 0} changes`]
              : []),
            `URL: ${prData["prUrl"] ?? prData["url"]}`,
          ];
          contextBlocks.push(lines.join("\n"));
        } catch {
          contextBlocks.push("```\n" + text + "\n```");
        }
      } else if (path.startsWith("issue://")) {
        try {
          const issueData = JSON.parse(text) as Record<string, unknown>;
          const labels = Array.isArray(issueData["labels"])
            ? issueData["labels"].join(", ")
            : "";
          const assignees = Array.isArray(issueData["assignees"])
            ? issueData["assignees"].join(", ")
            : "";
          const lines: string[] = [
            `[Issue Context] #${issueData["issueNumber"] ?? issueData["number"]} ${issueData["issueTitle"] ?? issueData["title"]}`,
            `State: ${issueData["issueState"] ?? issueData["state"]}`,
            ...(labels ? [`Labels: ${labels}`] : []),
            ...(assignees ? [`Assignees: ${assignees}`] : []),
            ...(issueData["comments"] != null
              ? [`Comments: ${issueData["comments"]}`]
              : []),
            `URL: ${issueData["issueUrl"] ?? issueData["url"]}`,
          ];
          contextBlocks.push(lines.join("\n"));
        } catch {
          contextBlocks.push("```\n" + text + "\n```");
        }
      } else {
        contextBlocks.push("```\n" + text + "\n```");
      }
    }
  }

  if (sessionRefs.length > 0) {
    contextBlocks.push(...sessionRefs);
  }

  return contextBlocks;
}

interface BuildSubmissionPayloadOptions {
  displayText: string;
  /**
   * Passage this message replies to. Prepended as a Markdown blockquote to
   * every display copy so history, re-editing and the agent all see the same
   * message; absent when the composer has no quote.
   */
  quotedSelection?: string;
  contextBlocks: string[];
  enableAgentInterceptors: boolean;
  hasAttachedImages: boolean;
  draftSessionId: string;
  submitComposerSnapshot: ComposerSnapshot | undefined;
  images: ChatImageAttachment[];
  isExplicitAction: boolean;
}

export function buildSubmissionPayload({
  displayText,
  quotedSelection,
  contextBlocks,
  enableAgentInterceptors,
  hasAttachedImages,
  draftSessionId,
  submitComposerSnapshot,
  images,
  isExplicitAction,
}: BuildSubmissionPayloadOptions) {
  // The shared projection owns the display/agent split: skill expansion,
  // `::base64` strip, and the Canvas contract. Canvas is additionally
  // gated like /compact and Address Comments above — attached images mean
  // the user is sending real content that happens to mention the command
  // — and on session capability: CLI agents have no render_inline_canvas
  // tool, so the message must pass through as ordinary text there.
  const quotedDisplayText = quotedSelection
    ? prependQuotedSelection(displayText, quotedSelection)
    : displayText;
  const { displayContent, agentContent } = projectOutgoingUserMessage({
    displayText: quotedDisplayText,
    contextBlocks,
    enableAgentInterceptors,
    allowCanvasInterception:
      !hasAttachedImages && !isCliSession(draftSessionId || null),
  });
  const projectedDisplayText = displayContent;
  const snapshotDisplayText = submitComposerSnapshot
    ? serializeSubmissionSnapshot(submitComposerSnapshot, true)
    : null;
  const displayTextWithoutMemberMentions =
    snapshotDisplayText === null
      ? projectedDisplayText
      : quotedSelection
        ? prependQuotedSelection(snapshotDisplayText, quotedSelection)
        : snapshotDisplayText;
  const { agentContent: agentContentWithoutMemberMentions } =
    projectOutgoingUserMessage({
      displayText: displayTextWithoutMemberMentions,
      contextBlocks,
      enableAgentInterceptors,
      allowCanvasInterception:
        !hasAttachedImages && !isCliSession(draftSessionId || null),
    });
  const memberMentions = submitComposerSnapshot
    ? memberMentionsFromSnapshot(submitComposerSnapshot)
    : [];

  const imageDataUrls = isExplicitAction
    ? []
    : images.map((img) => img.dataUrl);
  const submitKey = JSON.stringify({
    draftSessionId,
    displayText: projectedDisplayText,
    agentContent,
    memberIds: memberMentions.map((mention) => mention.memberId),
    imageDataUrls,
    composerSnapshot: submitComposerSnapshot,
  });

  return {
    displayText: projectedDisplayText,
    agentContent,
    displayTextWithoutMemberMentions,
    agentContentWithoutMemberMentions,
    memberMentions,
    imageDataUrls,
    submitKey,
  };
}
