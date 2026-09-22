/* @vitest-environment jsdom */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CoreSessionSummary } from "@src/api/tauri/lineage";
import type { Session } from "@src/store/session";
import { createHookLifecycleHarness } from "@src/test/hookLifecycleHarness";

import { useChatViewSessionImpact } from "./useChatViewSessionImpact";

const mocks = vi.hoisted(() => ({
  getOrgtrackSessionSummary: vi.fn(),
}));

vi.mock("@src/api/tauri/lineage", () => ({
  getOrgtrackSessionSummary: mocks.getOrgtrackSessionSummary,
}));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ warn: vi.fn() }),
}));

type Props = Parameters<typeof useChatViewSessionImpact>[0];

function summary(filesChanged: number): CoreSessionSummary {
  return {
    sessionId: "claudecodeapp-1",
    title: "Session",
    source: "claude_code",
    filesChanged,
    linesAdded: 4,
    linesRemoved: 3,
    relatedCommits: 1,
    committedRatePercent: 0,
  };
}

function row(overrides: Partial<Session>): Session {
  return {
    session_id: "claudecodeapp-1",
    updated_at: "2026-09-15T00:00:00Z",
    ...overrides,
  } as Session;
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createHarness() {
  return createHookLifecycleHarness((props: Props) =>
    useChatViewSessionImpact(props)
  );
}

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.clearAllMocks();
});

describe("useChatViewSessionImpact", () => {
  it("keeps the pill identity across row upserts that keep the numbers", async () => {
    mocks.getOrgtrackSessionSummary.mockResolvedValue(summary(5));
    const harness = createHarness();
    cleanup.push(harness.unmount);
    const props: Props = {
      sessionId: "claudecodeapp-1",
      isImportedHistory: true,
      session: row({ draftText: "a" }),
      assistantFingerprint: "reply-1",
    };

    await harness.render(props);
    await flushAsync();
    const first = harness.read().resolvedFileChangeStats;
    expect(first).toEqual({ count: 5, additions: 4, deletions: 3 });

    const readsBefore = mocks.getOrgtrackSessionSummary.mock.calls.length;
    await harness.render({ ...props, session: row({ draftText: "ab" }) });
    await flushAsync();
    expect(harness.read().resolvedFileChangeStats).toBe(first);
    expect(mocks.getOrgtrackSessionSummary.mock.calls.length).toBe(readsBefore);
  });

  it("re-reads the summary when the row refreshes or a reply completes", async () => {
    mocks.getOrgtrackSessionSummary.mockResolvedValue(summary(5));
    const harness = createHarness();
    cleanup.push(harness.unmount);
    const props: Props = {
      sessionId: "claudecodeapp-1",
      isImportedHistory: true,
      session: row({}),
      assistantFingerprint: "reply-1",
    };

    await harness.render(props);
    await flushAsync();

    mocks.getOrgtrackSessionSummary.mockClear();
    mocks.getOrgtrackSessionSummary.mockResolvedValue(summary(6));
    await harness.render({ ...props, assistantFingerprint: "reply-2" });
    await flushAsync();
    expect(mocks.getOrgtrackSessionSummary).toHaveBeenCalledTimes(1);
    expect(harness.read().resolvedFileChangeStats?.count).toBe(6);

    mocks.getOrgtrackSessionSummary.mockClear();
    await harness.render({
      ...props,
      assistantFingerprint: "reply-2",
      session: row({ updated_at: "2026-09-15T00:10:00Z" }),
    });
    await flushAsync();
    expect(mocks.getOrgtrackSessionSummary).toHaveBeenCalledTimes(1);
  });

  it("leaves native sessions to the artifact tracker", async () => {
    mocks.getOrgtrackSessionSummary.mockResolvedValue(summary(5));
    const harness = createHarness();
    cleanup.push(harness.unmount);
    const props: Props = {
      sessionId: "sdeagent-1",
      isImportedHistory: false,
      session: row({ session_id: "sdeagent-1", filesChanged: 3 }),
      assistantFingerprint: null,
    };

    await harness.render(props);
    await flushAsync();
    expect(harness.read().resolvedFileChangeStats).toBeUndefined();
    expect(harness.read().orgtrackSummary?.relatedCommits).toBe(1);

    mocks.getOrgtrackSessionSummary.mockClear();
    await harness.render({
      ...props,
      session: row({ session_id: "sdeagent-1", updated_at: "later" }),
    });
    await flushAsync();
    expect(mocks.getOrgtrackSessionSummary).not.toHaveBeenCalled();
  });
});
