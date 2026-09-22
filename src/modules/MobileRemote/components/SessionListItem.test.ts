// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SESSION_STATUS_DOT_COLOR } from "@src/util/session/sessionStatusDot";

import { SessionListItem, type SessionListItemProps } from "./SessionListItem";

function renderRow(
  status: SessionListItemProps["status"] = "idle",
  metadata: Pick<
    SessionListItemProps,
    | "workspaceName"
    | "updatedAtMs"
    | "display"
    | "visited"
    | "mergeStatus"
    | "compact"
  > = {}
): HTMLButtonElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(SessionListItem, {
      sessionId: "sdeagent-thread-1",
      name: "A very long session title that must remain inside its own row",
      status,
      ...metadata,
    })
  );
  const row = host.querySelector<HTMLButtonElement>(
    "[data-testid=mobile-remote-session-row]"
  );
  if (!row) throw new Error("Session row did not render");
  return row;
}

describe("SessionListItem layout", () => {
  it("uses a single aligned heading without a reserved metadata row in compact mode", () => {
    const row = renderRow("idle", {
      compact: true,
      workspaceName: "Project",
      updatedAtMs: 1000,
    });
    expect(row.classList.contains("mobile-session-row--compact")).toBe(true);
    expect(row.classList.contains("min-h-16")).toBe(false);
    expect(row.querySelector(".mobile-session-row__meta")).toBeNull();
    expect(row.querySelector(".mobile-session-row__workspace")).toBeNull();
    const heading = row.querySelector(".mobile-session-row__heading")!;
    expect(row.querySelector("time")).toBeNull();
    expect(heading.lastElementChild?.hasAttribute("data-session-status")).toBe(
      true
    );
    expect(
      renderRow("unknown", { compact: true, updatedAtMs: NaN }).querySelector(
        "time"
      )
    ).toBeNull();
  });
  it("shares Desktop's terminal unread rule without inventing unread before synchronization", () => {
    const green = (row: HTMLElement) =>
      row.innerHTML.includes(SESSION_STATUS_DOT_COLOR.unread);
    expect(green(renderRow("completed", { visited: false }))).toBe(true);
    expect(green(renderRow("completed", { visited: true }))).toBe(false);
    expect(green(renderRow("completed"))).toBe(false);
    expect(
      green(renderRow("completed", { visited: false, mergeStatus: "pending" }))
    ).toBe(false);
    expect(green(renderRow("running", { visited: false }))).toBe(false);
    expect(green(renderRow("waiting_for_user", { visited: false }))).toBe(
      false
    );
    expect(green(renderRow("offline", { visited: false }))).toBe(false);
  });
  it("renders the wire agent metadata instead of guessing solely from the session ID", () => {
    const original = renderRow().querySelector(
      "[data-icon=session-sdeagent-thread-1]"
    )!.innerHTML;
    const managed = renderRow("idle", {
      display: { cliAgentType: "claude_code" },
    });
    expect(
      managed.querySelector("[data-icon=session-sdeagent-thread-1]")!.innerHTML
    ).not.toBe(original);
  });
  it("keeps the full title accessible while placing the dot in the title line", () => {
    const row = renderRow();

    expect(row.tagName).toBe("BUTTON");
    expect(row.className).toContain("flex");
    expect(row.className).toContain("mobile-session-row");
    expect(row.className).toContain("min-h-16");
    expect(row.className).toContain("w-full");
    expect(row.children).toHaveLength(1);
    expect(row.querySelector("[data-icon=session-sdeagent-thread-1]")).not.toBe(
      null
    );
    expect(
      row.querySelector(".mobile-session-row__title")?.textContent
    ).toContain("A very long session title");
    expect(
      row.querySelector(".mobile-session-row__title")?.getAttribute("title")
    ).toBe("A very long session title that must remain inside its own row");
    expect(row.textContent).not.toContain("sessions.state.idle");
    expect(row.textContent).not.toContain("LIVE");
  });

  it("keeps workspace and date on the metadata line, separate from title and status", () => {
    const row = renderRow("idle", {
      workspaceName: "Long workspace",
      updatedAtMs: 1_700_000_000_000,
    });
    const meta = row.querySelector(".mobile-session-row__meta")!;
    expect(
      meta.querySelector(".mobile-session-row__workspace")?.textContent
    ).toBe("Long workspace");
    expect(meta.querySelector("time")?.dateTime).toBe(
      new Date(1_700_000_000_000).toISOString()
    );
    expect(meta.querySelector("[data-session-status]")).toBeNull();
    expect(row.querySelector(".mobile-session-row__heading time")).toBeNull();
  });

  it("does not invent workspace or date for missing or invalid metadata", () => {
    const row = renderRow("unknown", { updatedAtMs: Number.NaN });
    expect(row.querySelector("time")).toBeNull();
    expect(row.querySelector(".mobile-session-row__workspace")).toBeNull();
    expect(row.querySelector('[data-session-status="unknown"]')).not.toBeNull();
  });

  it("shows the same compact working status dot used by Desktop rows", () => {
    const row = renderRow("running");

    expect(row.querySelector('[aria-label="sessions.state.running"]')).not.toBe(
      null
    );
    expect(row.textContent).not.toContain("sessions.state.running");
  });

  it.each([
    ["running", "working"],
    ["awaiting_approval", "asking"],
    ["waiting_for_user", "asking"],
    ["waiting_for_funds", "working"],
    ["paused", "default"],
    ["completed", "default"],
    ["idle", "default"],
    ["offline", "default"],
    ["unknown", "default"],
  ] as const)(
    "uses Desktop's %s tone on one trailing dot, without status text",
    (status, tone) => {
      const row = renderRow(status);
      const marker = row.querySelector(`[data-session-status="${status}"]`)!;
      expect(
        row.querySelector(".mobile-session-row__heading")?.lastElementChild
      ).toBe(marker);
      expect(marker.querySelector("span")?.getAttribute("style")).toContain(
        SESSION_STATUS_DOT_COLOR[tone]
      );
      expect(
        row.querySelectorAll(`[aria-label="sessions.state.${status}"]`)
      ).toHaveLength(1);
      expect(row.textContent).not.toContain(`sessions.state.${status}`);
      expect(row.querySelector(".mobile-session-row__status")).toBeNull();
    }
  );
});
