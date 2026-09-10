import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  collectSessionSharedFiles,
  sharedFileAbsolutePath,
} from "./sessionSharedFileCandidates";

function event(overrides: Partial<SessionEvent>): SessionEvent {
  return {
    id: "e1",
    createdAt: "now",
    source: "assistant",
    displayStatus: "completed",
    displayVariant: "tool_call",
    uiCanonical: "",
    functionName: "",
    actionType: "tool_call",
    displayText: "",
    args: {},
    result: {},
    ...overrides,
  } as SessionEvent;
}
describe("session artifact discovery", () => {
  it("does not turn an empty extracted file path into the workspace directory", () => {
    expect(
      collectSessionSharedFiles(
        [
          event({
            uiCanonical: "write_file",
            extracted: {
              kind: "file",
              filePath: "",
              fileName: "",
              language: "text",
            } as SessionEvent["extracted"],
          }),
        ],
        "/repo"
      )
    ).toEqual([]);
    expect(sharedFileAbsolutePath("   ", "/repo")).toBeNull();
  });
  it("collects user file messages, successful writes and agent-generated linked output without a comment", () => {
    const result = collectSessionSharedFiles([
      event({
        source: "user",
        displayText: "spec.pdf [file:/author/spec.pdf]",
      }),
      event({
        id: "e2",
        uiCanonical: "write_file",
        filePath: "/author/result.md",
      }),
      event({
        id: "e3",
        displayVariant: "message",
        repoPath: "/author",
        displayText: "[Report](report.pdf) ![Plot](plot.png)",
      }),
    ]);
    expect(result.map((file) => file.path)).toEqual([
      "/author/spec.pdf",
      "/author/result.md",
      "/author/report.pdf",
      "/author/plot.png",
    ]);
  });
  it("never uploads read-only, deleted, failed, running, or remote references", () => {
    expect(
      collectSessionSharedFiles([
        event({ uiCanonical: "read_file", filePath: "/author/private.txt" }),
        event({
          uiCanonical: "write_file",
          filePath: "/author/running.txt",
          displayStatus: "running",
        }),
        event({
          uiCanonical: "write_file",
          filePath: "/author/failed.txt",
          displayStatus: "failed",
        }),
        event({ source: "user", displayText: "[web](https://example.com/a)" }),
        event({
          extracted: {
            kind: "edit",
            fileName: "file",
            language: "text",
            filePath: "/author/deleted",
            isDeleted: true,
            applyPatchSegments: [],
          } as SessionEvent["extracted"],
        }),
      ])
    ).toEqual([]);
  });
  it("handles multi-file patches and publishes the latest write revision once per path", () => {
    const result = collectSessionSharedFiles([
      event({ uiCanonical: "write_file", filePath: "/repo/a" }),
      event({
        id: "e2",
        repoPath: "/repo",
        extracted: {
          kind: "edit",
          fileName: "file",
          language: "text",
          filePath: "a",
          isDeleted: false,
          applyPatchSegments: [
            {
              filePath: "b",
              fileName: "b",
              language: "text",
              isDeleted: false,
              applyPatchSegments: [],
            },
          ],
        } as SessionEvent["extracted"],
      }),
    ]);
    expect(result).toEqual([
      { path: "/repo/a", revision: "e2:now" },
      { path: "/repo/b", revision: "e2:now" },
    ]);
  });
  it("resolves paths against the sender root and refuses unknown relative roots", () => {
    expect(
      sharedFileAbsolutePath("./docs/../report.md:12", "/author/repo")
    ).toBe("/author/repo/report.md");
    expect(sharedFileAbsolutePath("report.md")).toBeNull();
    expect(sharedFileAbsolutePath("/sender/my%20report.md#L12")).toBe(
      "/sender/my report.md"
    );
    expect(sharedFileAbsolutePath("file:///C:/reports/file.md")).toBe(
      "C:/reports/file.md"
    );
    expect(sharedFileAbsolutePath("#heading", "/repo")).toBeNull();
    expect(sharedFileAbsolutePath("file://other-host/report.md")).toBeNull();
    expect(sharedFileAbsolutePath("file:///author/report%20one.md")).toBe(
      "/author/report one.md"
    );
  });
});
