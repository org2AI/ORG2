import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

async function service() {
  return import("./documentApplications");
}

describe("document application discovery", () => {
  it("does no eager or timed discovery and single-flights exact files", async () => {
    const api = await service();
    expect(invoke).not.toHaveBeenCalled();
    let resolve!: (apps: []) => void;
    invoke.mockImplementation(
      () =>
        new Promise<[]>((done) => {
          resolve = done;
        })
    );
    const first = api.loadDocumentApplications("/file.pdf");
    expect(api.loadDocumentApplications("/file.pdf")).toBe(first);
    expect(invoke).toHaveBeenCalledTimes(1);
    resolve([]);
    await first;
    await api.loadDocumentApplications("/file.pdf");
    vi.advanceTimersByTime(60_001);
    expect(invoke).toHaveBeenCalledTimes(1);
    invoke.mockResolvedValue([]);
    await api.loadDocumentApplications("/file.pdf");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("bounds completed entries and keeps separate file associations", async () => {
    const api = await service();
    invoke.mockResolvedValue([]);
    for (let i = 0; i < 33; i++)
      await api.loadDocumentApplications(`/file-${i}.pdf`);
    await api.loadDocumentApplications("/file-32.pdf");
    expect(invoke).toHaveBeenCalledTimes(33);
    await api.loadDocumentApplications("/file-0.pdf");
    expect(invoke).toHaveBeenCalledTimes(34);
  });

  it("bounds pending requests without evicting their single-flight entries", async () => {
    const api = await service();
    invoke.mockImplementation(() => new Promise(() => {}));
    const first = api.loadDocumentApplications("/file-0.pdf");
    for (let i = 1; i < 32; i++)
      void api.loadDocumentApplications(`/file-${i}.pdf`);
    await expect(api.loadDocumentApplications("/overflow.pdf")).rejects.toThrow(
      "busy"
    );
    expect(api.loadDocumentApplications("/file-0.pdf")).toBe(first);
    expect(invoke).toHaveBeenCalledTimes(32);
  });

  it("allows explicit retry after failure and passes paths as data", async () => {
    const api = await service();
    invoke.mockRejectedValueOnce(new Error("failed"));
    await expect(api.loadDocumentApplications("/file.pdf")).rejects.toThrow(
      "failed"
    );
    invoke.mockResolvedValue([]);
    await api.loadDocumentApplications("/file.pdf");
    await api.openDocument("/a 'quoted'.pdf", "/Applications/Preview.app");
    expect(invoke).toHaveBeenLastCalledWith("document_open", {
      path: "/a 'quoted'.pdf",
      application: "/Applications/Preview.app",
    });
  });

  it("covers modern and legacy documents without detecting unrelated files", async () => {
    const api = await service();
    for (const ext of [
      "PDF",
      "doc",
      "docx",
      "xls",
      "xlsx",
      "ppt",
      "pptx",
      "pages",
      "odt",
    ])
      expect(api.isExternalDocument(`/file.${ext}`)).toBe(true);
    for (const path of ["/file.ts", "/pdf", "/file.pdf.ts"])
      expect(api.isExternalDocument(path)).toBe(false);
  });
});
