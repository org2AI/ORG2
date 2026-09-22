import { isMap, parseDocument } from "yaml";

import type { SkillEditorDraft } from "@src/modules/MainApp/Integrations/store/skills/skillEditorDraftAtom";

function readDocument(frontmatter: string) {
  const document = parseDocument(frontmatter);
  if (document.errors.length) throw new Error(document.errors[0].message);
  if (document.contents !== null && !isMap(document.contents)) {
    throw new Error("Skill frontmatter must be a YAML mapping");
  }
  return document;
}

export function parseSkillEditorDocument(content: string) {
  const match =
    /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(
      content
    );
  if (/^(?:\uFEFF)?---[ \t]*\r?\n/.test(content) && !match) {
    throw new Error("Skill frontmatter is missing its closing delimiter");
  }
  const frontmatter = match?.[1] ?? "";
  const document = readDocument(frontmatter);
  const values: Record<string, unknown> = document.toJS() ?? {};
  const text = (key: string) => {
    const value = values[key];
    return typeof value === "string" || typeof value === "number"
      ? String(value)
      : "";
  };
  const strings = (key: string): string[] =>
    Array.isArray(values[key])
      ? values[key].filter(
          (value): value is string => typeof value === "string"
        )
      : [];
  return {
    originalFrontmatter: frontmatter,
    description: text("description"),
    alwaysActive: values.always === true,
    version: text("version"),
    license: text("license"),
    compatibility: text("compatibility"),
    requiredBins: strings("bins"),
    requiredEnv: strings("env"),
    body: match
      ? content.slice(match[0].length).replace(/^\r?\n/, "")
      : content,
  };
}

/** Edit only changed fields on the original YAML tree, retaining unknown nodes/comments. */
export function buildSkillEditorFrontmatter(draft: SkillEditorDraft): string {
  const source = draft.originalFrontmatter ?? "";
  const document = readDocument(source);
  const original = parseSkillEditorDocument(`---\n${source}\n---\n`);
  const fields = {
    description: draft.description,
    always: draft.alwaysActive,
    version: draft.version,
    license: draft.license,
    compatibility: draft.compatibility,
    bins: draft.requiredBins,
    env: draft.requiredEnv,
  };
  const previous = {
    description: original.description,
    always: original.alwaysActive,
    version: original.version,
    license: original.license,
    compatibility: original.compatibility,
    bins: original.requiredBins,
    env: original.requiredEnv,
  };
  let changed = draft.originalFrontmatter === null;
  if (document.get("name") !== draft.name) {
    document.set("name", draft.name);
    changed = true;
  }
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
    const value = fields[key];
    if (JSON.stringify(value) === JSON.stringify(previous[key])) continue;
    document.set(key, value);
    changed = true;
  }
  return changed ? document.toString().trimEnd() : source;
}
