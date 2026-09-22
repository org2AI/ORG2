// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LINK_OPEN_TARGET_STORAGE_KEY } from "@src/store/ui/linkOpenTargetAtom";

import {
  OPEN_URL_IN_BROWSER_EVENT,
  type OpenUrlInBrowserDetail,
  linkAnchorProps,
  openInBrowserApp,
  openInSystemBrowser,
  openLink,
} from "../openLink";

const mocks = vi.hoisted(() => ({
  openUrl: vi.fn(),
  messageError: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@src/components/Message", () => ({
  default: { error: mocks.messageError },
}));
vi.mock("@src/i18n", () => ({ default: { t: (key: string) => key } }));

let browserRequests: OpenUrlInBrowserDetail[];
let browserTakesRequests: boolean;

/** Stands in for `useOpenUrlInBrowser`, which acknowledges what it opens. */
function browserHost(event: Event): void {
  browserRequests.push((event as CustomEvent<OpenUrlInBrowserDetail>).detail);
  if (browserTakesRequests) event.preventDefault();
}

function chooseLinkTarget(target: string): void {
  localStorage.setItem(LINK_OPEN_TARGET_STORAGE_KEY, JSON.stringify(target));
}

beforeEach(() => {
  browserRequests = [];
  browserTakesRequests = true;
  localStorage.removeItem(LINK_OPEN_TARGET_STORAGE_KEY);
  mocks.openUrl.mockReset().mockResolvedValue(undefined);
  mocks.messageError.mockReset();
  window.addEventListener(OPEN_URL_IN_BROWSER_EVENT, browserHost);
});

afterEach(() => {
  window.removeEventListener(OPEN_URL_IN_BROWSER_EVENT, browserHost);
});

describe("openLink with the workstation Browser chosen", () => {
  it("hands every link to the Browser, whatever kind of address it is", () => {
    openLink("https://github.com/org2AI/ORG2/pull/851");
    openLink("https://github.com/org2AI/ORG2/issues/851");
    openLink("https://example.com/docs");

    expect(browserRequests).toEqual([
      { url: "https://github.com/org2AI/ORG2/pull/851" },
      { url: "https://github.com/org2AI/ORG2/issues/851" },
      { url: "https://example.com/docs" },
    ]);
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("uses the system browser when no Browser in this document takes the link", () => {
    browserTakesRequests = false;

    openLink("https://example.com/docs");

    expect(browserRequests).toHaveLength(1);
    expect(mocks.openUrl).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("uses the system browser when nothing listens at all", () => {
    window.removeEventListener(OPEN_URL_IN_BROWSER_EVENT, browserHost);

    openLink("https://github.com/org2AI/ORG2/pull/851");

    expect(mocks.openUrl).toHaveBeenCalledWith(
      "https://github.com/org2AI/ORG2/pull/851"
    );
  });
});

describe("openLink with the system browser chosen", () => {
  it("never asks the Browser", () => {
    chooseLinkTarget("external");

    openLink("https://github.com/org2AI/ORG2/pull/851");
    openLink("https://example.com/docs");

    expect(browserRequests).toEqual([]);
    expect(mocks.openUrl.mock.calls).toEqual([
      ["https://github.com/org2AI/ORG2/pull/851"],
      ["https://example.com/docs"],
    ]);
  });

  it("follows a change made after earlier clicks without a reload", () => {
    openLink("https://example.com/one");
    chooseLinkTarget("external");
    openLink("https://example.com/two");
    chooseLinkTarget("internal");
    openLink("https://example.com/three");

    expect(browserRequests.map((detail) => detail.url)).toEqual([
      "https://example.com/one",
      "https://example.com/three",
    ]);
    expect(mocks.openUrl.mock.calls).toEqual([["https://example.com/two"]]);
  });
});

describe("controls that name their destination", () => {
  it("opens the Browser in view even when links go to the system browser", () => {
    chooseLinkTarget("external");

    openInBrowserApp("https://example.com/docs");

    expect(browserRequests).toEqual([{ url: "https://example.com/docs" }]);
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("falls back to the system browser where there is no Browser", () => {
    browserTakesRequests = false;

    openInBrowserApp("https://example.com/docs");

    expect(mocks.openUrl).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("opens the system browser even when links go to the Browser", () => {
    openInSystemBrowser("https://example.com/docs");

    expect(browserRequests).toEqual([]);
    expect(mocks.openUrl).toHaveBeenCalledWith("https://example.com/docs");
  });
});

describe("openInSystemBrowser", () => {
  it("opens the address the Browser would for scheme-less input", () => {
    openInSystemBrowser("example.com/docs");

    expect(mocks.openUrl).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("reports a system browser that fails to open", async () => {
    mocks.openUrl.mockRejectedValueOnce(new Error("no handler"));

    openInSystemBrowser("https://example.com/docs");

    await vi.waitFor(() =>
      expect(mocks.messageError).toHaveBeenCalledWith(
        "sessions:cards.url.openExternalFailed"
      )
    );
  });
});

describe("linkAnchorProps", () => {
  it("keeps the address on the anchor and opens it as a link on click", () => {
    const anchor = document.createElement("a");
    const props = linkAnchorProps("https://example.com/docs");
    anchor.href = props.href;
    anchor.addEventListener("click", props.onClick);
    document.body.appendChild(anchor);

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(click);
    anchor.remove();

    expect(props.href).toBe("https://example.com/docs");
    expect(click.defaultPrevented).toBe(true);
    expect(browserRequests).toEqual([{ url: "https://example.com/docs" }]);
  });
});
