// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { CookieImportSource } from "@src/api/tauri/browserCookies";

import {
  type ImportCookiesController,
  useImportCookiesController,
} from "./useImportCookiesController";

const api = vi.hoisted(() => ({
  listCookieImportSources: vi.fn(),
  previewCookieImport: vi.fn(),
}));

// `t` must keep its identity across renders like the real one does: the scan
// effect depends on it, and its cleanup invalidates in-flight requests.
vi.mock("react-i18next", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock("@src/components/Message", () => ({
  default: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@src/api/tauri/browserCookies", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@src/api/tauri/browserCookies")>()),
  listCookieImportSources: api.listCookieImportSources,
  previewCookieImport: api.previewCookieImport,
}));

const SAFARI: CookieImportSource = {
  id: "safari",
  kind: "safari",
  browserId: "safari",
  browserLabel: "Safari",
  profileLabel: null,
  unavailableReason: null,
};

let root: Root;
let container: HTMLDivElement;
const latest: { controller: ImportCookiesController | null } = {
  controller: null,
};
const controller = (): ImportCookiesController => latest.controller!;

function Probe({
  onRender,
}: {
  onRender: (controller: ImportCookiesController) => void;
}): null {
  const current = useImportCookiesController();
  useEffect(() => onRender(current));
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.listCookieImportSources.mockResolvedValue([SAFARI]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(Probe, {
        onRender: (current) => {
          latest.controller = current;
        },
      })
    )
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("turns a source macOS refuses to read into a blocked row, not a dead end", async () => {
  // The scan believed Safari was readable; the preview is where macOS says no.
  expect(controller().sources[0].unavailableReason).toBeNull();
  api.previewCookieImport.mockRejectedValue({
    code: "full_disk_access",
    message: "Operation not permitted",
  });

  await act(async () => controller().selectSource("safari"));

  expect(controller().stage).toBe("sources");
  expect(controller().activeSource).toBeNull();
  expect(controller().sources[0].unavailableReason).toBe(
    "needs_full_disk_access"
  );
});

it("does not try to preview a source that is already blocked", async () => {
  api.listCookieImportSources.mockResolvedValue([
    { ...SAFARI, unavailableReason: "needs_full_disk_access" },
  ]);
  await act(async () => controller().refreshSources());

  await act(async () => controller().selectSource("safari"));

  expect(api.previewCookieImport).not.toHaveBeenCalled();
  expect(controller().stage).toBe("sources");
});

it("clears the blocked mark once a re-scan finds the store readable", async () => {
  api.previewCookieImport.mockRejectedValue({
    code: "full_disk_access",
    message: "Operation not permitted",
  });
  await act(async () => controller().selectSource("safari"));
  expect(controller().sources[0].unavailableReason).not.toBeNull();

  // The user granted Full Disk Access and pressed "Check again".
  await act(async () => controller().refreshSources());

  expect(api.listCookieImportSources).toHaveBeenCalledTimes(2);
  expect(controller().sources[0].unavailableReason).toBeNull();
});
