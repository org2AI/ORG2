// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDocument } from "yaml";

import {
  createEmptySkillDraft,
  skillEditorDraftAtom,
} from "@src/modules/MainApp/Integrations/store/skills/skillEditorDraftAtom";
import { createSmokeRoot } from "@src/test/reactSmokeHarness";
import type { InstalledSkill } from "@src/types/extensions";

import { type UseSkillEditorReturn, useSkillEditor } from "../useSkillEditor";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
const skill = {
  name: "demo",
  path: "/skills/demo/SKILL.md",
  source: "user",
  description: "",
  bundledFiles: [],
} as unknown as InstalledSkill;
const original =
  '# document comment\nname: demo\ndescription: |\n  First line\n  Second line\nmetadata: # keep metadata\n  author: tester\n  nested:\n    - value: "one: two"';
let root: ReturnType<typeof createSmokeRoot>;
let store: ReturnType<typeof createStore>;
let editor: UseSkillEditorReturn;
function Probe() {
  const value = useSkillEditor();
  useEffect(() => {
    editor = value;
  }, [value]);
  return null;
}
async function open(files: InstalledSkill["bundledFiles"] = []) {
  await act(async () =>
    editor.startEdit(
      { ...skill, bundledFiles: files },
      `---\n${original}\n---\n\nBody`
    )
  );
}
beforeEach(async () => {
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue(undefined);
  root = createSmokeRoot();
  store = createStore();
  await root.render(createElement(Provider, { store }, createElement(Probe)));
});
afterEach(async () => root.unmount());

describe("skill editor persistence", () => {
  it("preserves comments, unknown metadata and block scalars through a body-only save", async () => {
    await open();
    expect(editor.draft?.description).toBe("First line\nSecond line\n");
    await act(async () => editor.updateDraft({ body: "Changed body" }));
    await act(async () => expect(await editor.save()).toBe(true));
    expect(mocks.invoke).toHaveBeenCalledWith("skills_update", {
      skillPath: skill.path,
      frontmatter: original,
      body: "Changed body",
    });
    expect(store.get(skillEditorDraftAtom)).toBeNull();
  });
  it("quotes edited YAML scalars while keeping untouched nested nodes and comments", async () => {
    await open();
    await act(async () =>
      editor.updateDraft({ description: 'Use: "a" # tag', version: '1: "x"' })
    );
    await act(async () => editor.save());
    const payload = mocks.invoke.mock.calls.find(
      ([command]) => command === "skills_update"
    )?.[1];
    const document = parseDocument(payload.frontmatter);
    expect(document.errors).toEqual([]);
    expect(document.toJS()).toMatchObject({
      description: 'Use: "a" # tag',
      version: '1: "x"',
      metadata: { author: "tester", nested: [{ value: "one: two" }] },
    });
    expect(payload.frontmatter).toContain("# document comment");
    expect(payload.frontmatter).toContain("# keep metadata");
  });
  it("never rewrites binary, failed, unchanged or unchanged-empty attachments", async () => {
    mocks.invoke.mockImplementation(async (command) =>
      command === "skills_read_files_batch"
        ? [
            { relativePath: "asset.png", content: "", error: "invalid UTF-8" },
            {
              relativePath: "unreadable.txt",
              content: "",
              error: "permission denied",
            },
            { relativePath: "script.sh", content: "original", error: null },
            { relativePath: "empty.txt", content: "", error: null },
            {
              relativePath: "ascii.pdf",
              content: "%PDF-1.5 ASCII",
              error: null,
            },
          ]
        : undefined
    );
    await open([
      "asset.png",
      "unreadable.txt",
      "script.sh",
      "empty.txt",
      "ascii.pdf",
    ]);
    expect(editor.draft?.bundledFileDrafts[4].binary).toBe(true);
    expect(editor.draft?.bundledFileDrafts[0].readError).toBe("invalid UTF-8");
    await act(async () => editor.updateDraft({ body: "changed" }));
    await act(async () => expect(await editor.save()).toBe(true));
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "skills_write_files_batch"
      )
    ).toEqual([]);
  });
  it("writes explicit text changes including emptying a file and retries only failed writes", async () => {
    let attempts = 0;
    mocks.invoke.mockImplementation(async (command, payload) => {
      if (command === "skills_read_files_batch")
        return ["first.txt", "second.txt"].map((relativePath) => ({
          relativePath,
          content: "old",
          error: null,
        }));
      if (command === "skills_write_files_batch") {
        attempts++;
        return payload.files.map((file: { relativePath: string }) => ({
          relativePath: file.relativePath,
          success: attempts > 1 || file.relativePath === "first.txt",
          error: "write denied",
        }));
      }
    });
    await open(["first.txt", "second.txt"]);
    await act(async () =>
      editor.updateDraft({
        bundledFileDrafts: editor.draft!.bundledFileDrafts.map((file) => ({
          ...file,
          content: "",
        })),
      })
    );
    await act(async () => expect(await editor.save()).toBe(false));
    expect(editor.saveError).toContain("second.txt");
    await act(async () => expect(await editor.save()).toBe(true));
    const writes = mocks.invoke.mock.calls.filter(
      ([command]) => command === "skills_write_files_batch"
    );
    expect(writes[0][1].files).toEqual([
      { relativePath: "first.txt", content: "" },
      { relativePath: "second.txt", content: "" },
    ]);
    expect(writes[1][1].files).toEqual([
      { relativePath: "second.txt", content: "" },
    ]);
  });
  it("retries attachment failure after create without attempting to recreate the skill", async () => {
    await act(async () =>
      store.set(skillEditorDraftAtom, {
        ...createEmptySkillDraft(),
        name: "demo",
        bundledFileDrafts: [{ relativePath: "script.sh", content: "new" }],
      })
    );
    await act(async () => {});
    let attempts = 0;
    mocks.invoke.mockImplementation(async (command) => {
      if (command === "skills_create") return { path: skill.path };
      if (command === "skills_write_files_batch")
        return [
          {
            relativePath: "script.sh",
            success: ++attempts > 1,
            error: "write denied",
          },
        ];
    });
    await act(async () => expect(await editor.save()).toBe(false));
    expect(editor.draft?.editingSkillPath).toBe(skill.path);
    await act(async () => expect(await editor.save()).toBe(true));
    expect(
      mocks.invoke.mock.calls.filter(([command]) => command === "skills_create")
    ).toHaveLength(1);
    expect(
      mocks.invoke.mock.calls.filter(([command]) => command === "skills_update")
    ).toHaveLength(1);
  });
  it("guards duplicate saves and preserves a new draft when an older save finishes", async () => {
    await open();
    let complete!: () => void;
    mocks.invoke.mockImplementation((command) =>
      command === "skills_update"
        ? new Promise<void>((resolve) => {
            complete = resolve;
          })
        : Promise.resolve()
    );
    let first!: Promise<boolean>;
    await act(async () => {
      first = editor.save();
      expect(await editor.save()).toBe(false);
    });
    await act(async () => {
      editor.discard();
    });
    await act(async () => {
      editor.startCreate();
    });
    await act(async () => {
      complete();
      await first;
    });
    expect(store.get(skillEditorDraftAtom)?.editingSkillPath).toBeNull();
    expect(
      mocks.invoke.mock.calls.filter(([command]) => command === "skills_update")
    ).toHaveLength(1);
  });
  it("discards a late attachment load after another skill is opened", async () => {
    let complete!: (value: unknown[]) => void;
    mocks.invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    let first!: Promise<void>;
    await act(async () => {
      first = editor.startEdit(
        { ...skill, bundledFiles: ["slow.txt"] },
        "Body"
      );
    });
    await act(async () =>
      editor.startEdit({ ...skill, name: "new", bundledFiles: [] }, "New body")
    );
    await act(async () => {
      complete([]);
      await first;
    });
    expect(editor.draft?.name).toBe("new");
  });
});
