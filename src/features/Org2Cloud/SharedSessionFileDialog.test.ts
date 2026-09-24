// @vitest-environment jsdom
import { act, createElement } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type SmokeRoot, createSmokeRoot } from "@src/test/reactSmokeHarness";

import SharedSessionFileLink from "./SharedSessionFileLink";
import {
  SharedSessionFilesProvider,
  useOpenSessionSharedFile,
} from "./SharedSessionFilesContext";

// Hold the actual dynamic-import boundary unresolved to exercise the cold click.
vi.mock("./SharedSessionFileViewer", () => new Promise(() => {}));
vi.mock("@src/scaffold/ModalSystem", () => ({
  default: ({
    children,
    title,
    onCancel,
  }: {
    children: ReactNode;
    title: string;
    onCancel: () => void;
  }) =>
    createElement(
      "section",
      { role: "dialog", "aria-label": title },
      children,
      createElement("button", { onClick: onCancel }, "Close")
    ),
}));

const reference = {
  id: "file-id",
  endpoint: "https://cloud.example",
  source: { orgId: "org", sessionId: "session", path: "/sender/report.md" },
};
function PathLink() {
  const open = useOpenSessionSharedFile();
  return createElement(
    "a",
    {
      href: "/sender/report.md",
      onClick: (event) => {
        event.preventDefault();
        open("/sender/report.md");
      },
    },
    "Report"
  );
}
describe("shared file cold loading feedback", () => {
  let root: SmokeRoot;
  beforeEach(() => {
    root = createSmokeRoot();
  });
  afterEach(async () => {
    await root.unmount();
  });

  it.each(["explicit file link", "sender path"])(
    "shows a closeable loading shell for %s before viewer code resolves",
    async (entry) => {
      await root.render(
        entry === "explicit file link"
          ? createElement(
              SharedSessionFileLink,
              { href: "orgii-file://file-id", reference },
              "Report"
            )
          : createElement(
              SharedSessionFilesProvider,
              {
                scope: {
                  orgId: "org",
                  sessionId: "session",
                  endpoint: reference.endpoint,
                },
              },
              createElement(PathLink)
            )
      );
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(async () => {
        root.container.querySelector("a")!.click();
      });
      expect(
        document.querySelector('[role="dialog"]')?.getAttribute("aria-label")
      ).toBe("report.md");
      expect(document.querySelector('[role="status"]')?.textContent).toBe(
        "sharedFile.loading"
      );
      await act(async () => {
        document
          .querySelector<HTMLButtonElement>('[role="dialog"] button')!
          .click();
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    }
  );
});
