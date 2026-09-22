/** @vitest-environment jsdom */
import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import type { CloudSessionComment } from "../org2CloudCommentsClient";
import CommentThreadList from "./CommentThreadList";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/components/MarkdownContent", () => ({
  MarkdownContent: ({ body }: { body: string }) =>
    React.createElement("p", null, body),
}));

const comment = (
  id: string,
  fields: Partial<CloudSessionComment> = {}
): CloudSessionComment => ({
  id,
  authorUserId: "author",
  body: `Note ${id}`,
  createdAt: "2026-09-22T00:00:00Z",
  ...fields,
});

describe("read-only cloud notes", () => {
  it("preserves replies, tombstones, agent attribution and resolved disclosure without mutation controls", async () => {
    const root = createSmokeRoot();
    try {
      await root.render(
        React.createElement(CommentThreadList, {
          threads: [
            {
              top: comment("active", {
                body: "@agent inspect this",
                mentionedUserIds: ["teammate"],
              }),
              replies: [
                comment("reply", { kind: "agent_report" }),
                comment("deleted", {
                  body: "",
                  deletedAt: "2026-09-22T01:00:00Z",
                }),
              ],
            },
            {
              top: comment("resolved", {
                resolvedAt: "2026-09-22T01:00:00Z",
                resolution: "resolved",
              }),
              replies: [],
            },
          ],
        })
      );
      expect(root.container.textContent).toContain("inspect this");
      expect(root.container.textContent).toContain("@teammate");
      expect(root.container.textContent).toContain(
        "cloud.comments.deletedComment"
      );
      expect(
        root.container.querySelector('[data-testid="comment-agent-affix"]')
      ).not.toBeNull();
      expect(root.container.textContent).not.toContain("Note resolved");
      expect(root.container.querySelectorAll("button")).toHaveLength(1);
      expect(root.container.querySelector("textarea, input")).toBeNull();
      const toggle = root.container.querySelector("button")!;
      await act(async () => toggle.click());
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(root.container.textContent).toContain("Note resolved");
      expect(
        root.container.querySelectorAll('[data-testid="session-comment-row"]')
      ).toHaveLength(4);
    } finally {
      await root.unmount();
    }
  });
});
