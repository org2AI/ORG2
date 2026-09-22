import { describe, expect, it } from "vitest";

import {
  getTurnPageHeaderGroupIndex,
  projectChatTurnPagination,
} from "@src/engines/ChatPanel/ChatHistory/hooks/useChatTurnPagination";
import { projectChatHistory } from "@src/engines/ChatPanel/ChatHistory/projection/core";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { isVisibleInChat } from "@src/engines/SessionCore/ingestion/visibilityFilters";

import fixture from "../../../../src-tauri/src/agent_sessions/event_pipeline/fixtures/retry_audit_boundary.json";
import { projectNativeConversationItems } from "./nativeConversationProjection";
import { nativeSourceEventId } from "./nativeSourceEventIdentity";
import { projectQueuedRetryChatEvents } from "./queuedRetryLineage";
import { isRetryAuditBoundary } from "./retryAuditBoundary";

const raw = fixture as SessionEvent[];

describe("superseded retry audit ownership", () => {
  it.each([false, true])(
    "keeps lazy A and the old B diagnostic in separate groups (collapsed=%s)",
    (collapsed) => {
      const projected = projectQueuedRetryChatEvents(raw);
      const boundary = projected.find(isRetryAuditBoundary)!;
      expect(boundary.id).toBe("old-B");
      expect(
        projected
          .filter((event) => event.source === "user")
          .map((event) => event.id)
      ).toEqual(["A", "new-B"]);
      expect(raw.find((event) => event.id === "old-B")?.source).toBe("user");
      const groups = projectChatHistory(projected.filter(isVisibleInChat), {
        groups: { tailTurnPhase: "complete", allTurnsCollapsed: collapsed },
      }).groups!;
      expect(
        groups.groupHeaders.map((header) => header?.event?.id ?? null)
      ).toEqual(["A", null, "new-B"]);
      expect(groups.groupMeta[0].unloadedTurn?.turnId).toBe("A");
      // This catalog fixture still bounds old A at the next turn's start. The
      // unrelated failure must never extend that already recorded window.
      expect(groups.groupMeta[0].endMs).toBe(Date.parse(raw[1].createdAt));
      const ids = groups.flatItems.map((item) => item.event?.id);
      expect(ids).toEqual(["lazy-A", "old-B-error", "new-B-answer"]);
      expect(groups.groupCounts).toEqual([1, 1, 1]);
      expect(
        projectNativeConversationItems(projected).every(
          (item) => item.id !== nativeSourceEventId(boundary)
        )
      ).toBe(true);
    }
  );

  it("reestablishes the audit boundary after lazy hydration replaces the original same-id row", () => {
    const projected = projectQueuedRetryChatEvents(raw);
    const hydrated = projected.map((event) =>
      event.id === "old-B"
        ? raw.find((original) => original.id === "old-B")!
        : event
    );
    expect(projectQueuedRetryChatEvents(hydrated)).toEqual(projected);
    const carried = raw.map((event) =>
      event.id === "old-B"
        ? {
            ...event,
            args: { __orgiiSourceEventId: "orgii_evt_original_B" },
          }
        : event
    );
    const boundary =
      projectQueuedRetryChatEvents(carried).find(isRetryAuditBoundary)!;
    expect(nativeSourceEventId(boundary)).toBe("orgii_evt_original_B");
    expect(projectNativeConversationItems([boundary])).toEqual([]);
  });

  it("keeps four logical turn pages while retaining the retry audit as a separate group", () => {
    const extended = [
      ...raw,
      ...["C", "D"].flatMap((id, index) => [
        {
          ...raw[4],
          id,
          createdAt: `2026-09-18T17:17:0${index * 2}.000Z`,
          displayText: id,
          result: { turnIntentId: id },
        },
        {
          ...raw[5],
          id: `${id}-answer`,
          createdAt: `2026-09-18T17:17:0${index * 2 + 1}.000Z`,
          displayText: `${id} done`,
        },
      ]),
    ];
    const groups = projectChatHistory(
      projectQueuedRetryChatEvents(extended).filter(isVisibleInChat),
      {
        groups: { tailTurnPhase: "complete", allTurnsCollapsed: true },
      }
    ).groups!;
    const pages = projectChatTurnPagination({
      ...groups,
      enabled: true,
      activePageIndex: 1,
    });
    expect(
      groups.groupHeaders.map((header) => header?.event?.id ?? null)
    ).toEqual(["A", null, "new-B", "C", "D"]);
    expect(pages.pageCount).toBe(4);
    expect(groups.groupMeta[1].retryAudit).toBe(true);
    expect(
      pages.pages.map(
        (page) =>
          groups.groupHeaders[
            getTurnPageHeaderGroupIndex(page, groups.groupHeaders)
          ]?.event?.id
      )
    ).toEqual(["A", "new-B", "C", "D"]);
    expect(
      pages.displayGroupHeaders.map((header) => header?.event?.id ?? null)
    ).toEqual([null, "new-B"]);
    expect(pages.displayFlatItems.map((item) => item.event?.id)).toEqual([
      "old-B-error",
      "new-B-answer",
    ]);
    expect(pages.displayGroupCounts).toEqual([1, 1]);
    const nonAudit = projectChatTurnPagination({
      ...groups,
      enabled: true,
      activePageIndex: 1,
      groupMeta: groups.groupMeta.map(
        ({ retryAudit: _retryAudit, ...meta }) => meta
      ),
    });
    expect(nonAudit.pageCount).toBe(5); // Existing headerless content remains independently navigable.
  });

  it("fails closed on absent, unknown-version and malformed lineage", () => {
    for (const events of [
      raw.slice(0, -1),
      raw.map((event) =>
        event.actionType === "queued_retry_lineage"
          ? {
              ...event,
              result: {
                retryLineage: {
                  ...(event.result.retryLineage as object),
                  version: 2,
                },
              },
            }
          : event
      ),
      raw.map((event) =>
        event.actionType === "queued_retry_lineage"
          ? { ...event, id: "wrong-id" }
          : event
      ),
    ]) {
      const projected = projectQueuedRetryChatEvents(events);
      expect(projected.some(isRetryAuditBoundary)).toBe(false);
      expect(projected.filter((event) => event.source === "user")).toHaveLength(
        3
      );
    }
  });
});
