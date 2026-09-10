// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { FileOperationsService } from "@src/services/file/FileOperationsService";
import { getPreviewType } from "@src/util/file/previewTypes";

import BinaryView from "./BinaryView";

vi.mock("@src/services/file/FileOperationsService", () => ({
  FileOperationsService: {
    revealInFinder: vi.fn().mockResolvedValue({ success: true }),
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/util/platform/tauri", () => ({ isTauriDesktop: () => true }));
vi.mock("@src/modules/WorkStation/shared", () => ({
  TabBarBottomPanelToggle: () => null,
  FileHeader: ({
    onRevealInFileManager,
    relativePathToCopy,
    renderFileActions,
  }: {
    onRevealInFileManager: () => void;
    relativePathToCopy: string;
    renderFileActions: (close: () => void) => React.ReactNode;
  }) =>
    React.createElement(
      "div",
      null,
      React.createElement(
        "button",
        { onClick: onRevealInFileManager },
        "Reveal"
      ),
      relativePathToCopy,
      renderFileActions?.(() => {})
    ),
}));
vi.mock("../../FilePreviewContent", () => ({
  PdfPreview: () => null,
  ImagePreview: () => null,
  VideoPreview: () => null,
}));
vi.mock("../DocumentOpenMenu/DocumentOpenSubmenu", () => ({
  default: ({ filePath }: { filePath: string }) =>
    React.createElement("span", null, `Open in ${filePath}`),
}));
vi.mock("../DocumentOpenMenu", () => ({ default: () => null }));

it.each(["pdf", "pages"])(
  "wires %s actions to the selected file and preserves unsupported routing",
  async (extension) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          React.createElement(BinaryView, {
            selectedFile: `/repo/docs/report.${extension}`,
            relativePath: `docs/report.${extension}`,
            repoPath: "/repo",
            fileContent: "",
            previewType: getPreviewType(`report.${extension}`),
            readOnly: true,
            onFileSelect: vi.fn(),
            onReload: vi.fn(),
          })
        )
      );
      expect(container.textContent).toContain(`docs/report.${extension}`);
      expect(container.textContent).toContain(
        `Open in /repo/docs/report.${extension}`
      );
      if (extension === "pages")
        expect(container.textContent).toContain(
          "placeholders.unsupportedFileType"
        );
      await act(async () => container.querySelector("button")!.click());
      expect(FileOperationsService.revealInFinder).toHaveBeenCalledWith(
        `/repo/docs/report.${extension}`
      );
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  }
);
