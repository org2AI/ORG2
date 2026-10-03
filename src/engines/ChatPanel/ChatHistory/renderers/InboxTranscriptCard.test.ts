// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeSessionEvent } from "@src/engines/SessionCore/rendering/props/__tests__/fixtures";

import { InboxTranscriptCard } from "./InboxTranscriptCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: unknown) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));
vi.mock("@src/engines/SessionCore", () => ({
  useEventNavigation: () => ({ navigateToEvent: vi.fn() }),
}));

describe("materialized inbox provenance", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      }
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("shows recipient, sender and exact count while folded, then opens the actual input", async () => {
    const event = makeSessionEvent({
      id: "inbox-input",
      function: "user_message",
      source: "user",
      result: {
        message: { content: "Review the keyboard handling", role: "user" },
        agentOrgExecution: {
          turnIntentId: "worker-turn",
          participantId: "reviewer",
          participantName: "Reviewer",
          sourceKind: "member_messages",
          inboxCount: 2,
          senders: [{ memberId: "builder", name: "Builder", count: 2 }],
        },
      },
    });
    await act(async () =>
      root.render(createElement(InboxTranscriptCard, { event }))
    );
    expect(host.textContent).toContain('"recipient":"Reviewer"');
    expect(host.textContent).toContain('"count":2');
    expect(host.textContent).toContain("Builder (2)");
    expect(host.textContent).not.toContain("Review the keyboard handling");
    const disclosure = host.querySelector<HTMLButtonElement>(
      'button[aria-expanded="false"]'
    );
    expect(disclosure).not.toBeNull();
    await act(async () => disclosure!.click());
    expect(host.textContent).toContain("Review the keyboard handling");
    expect(host.querySelector('button[aria-expanded="true"]')).not.toBeNull();
  });

  it("does not assign a legacy transcript to the coordinator or invent senders", async () => {
    const event = makeSessionEvent({
      result: { message: { content: "Legacy input", role: "user" } },
    });
    await act(async () =>
      root.render(createElement(InboxTranscriptCard, { event }))
    );
    expect(host.textContent).toContain("agentOrgExecution.legacyInbox");
    expect(host.textContent).not.toContain("Coordinator");
    expect(host.textContent).not.toContain("inboxSummary");
  });
});
