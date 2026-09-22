/**
 * Business logic hook for the Skill Editor.
 *
 * Handles: draft management, validation, token estimation,
 * save (create/update), and frontmatter generation.
 */
import { invoke } from "@tauri-apps/api/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useMounted } from "@src/hooks/lifecycle/useMounted";
import {
  type BundledFileDraft,
  SKILL_SCOPE,
  type SkillEditorDraft,
  clearSkillEditorDraftAtom,
  createEmptySkillDraft,
  setSkillEditorDraftAtom,
  skillEditorDraftAtom,
} from "@src/modules/MainApp/Integrations/store/skills/skillEditorDraftAtom";
import type { InstalledSkill } from "@src/types/extensions";
import {
  DESCRIPTION_QUALITY,
  type DescriptionQuality,
  SKILL_SOURCE,
} from "@src/types/extensions/types";
import { isTextFile } from "@src/util/file/binaryDetection";

import {
  buildSkillEditorFrontmatter,
  parseSkillEditorDocument,
} from "./skillEditorDocument";

function assessDescriptionQuality(description: string): DescriptionQuality {
  if (!description.trim()) return DESCRIPTION_QUALITY.MISSING;
  if (description.trim().length < 20) return DESCRIPTION_QUALITY.SHORT;
  return DESCRIPTION_QUALITY.GOOD;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface UseSkillEditorOptions {
  workspacePath?: string | null;
}

export interface UseSkillEditorReturn {
  draft: SkillEditorDraft | null;
  isEditing: boolean;
  descriptionQuality: DescriptionQuality;
  estimatedTokenCount: number;
  saving: boolean;
  saveError: string | null;
  validationError: string | null;
  updateDraft: (updates: Partial<SkillEditorDraft>) => void;
  startCreate: () => void;
  startEdit: (skill: InstalledSkill, content: string) => Promise<void>;
  save: () => Promise<boolean>;
  discard: () => void;
  validateName: (name: string) => Promise<string | null>;
}

export function useSkillEditor(
  options: UseSkillEditorOptions = {}
): UseSkillEditorReturn {
  const draft = useAtomValue(skillEditorDraftAtom);
  const setDraft = useSetAtom(setSkillEditorDraftAtom);
  const clearDraft = useSetAtom(clearSkillEditorDraftAtom);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const mountedRef = useMounted();
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const savingRef = useRef(false);
  const editGeneration = useRef(0);

  const isEditing =
    draft?.editingSkillPath !== null && draft?.editingSkillPath !== undefined;

  const descriptionQuality = useMemo(
    () => assessDescriptionQuality(draft?.description ?? ""),
    [draft?.description]
  );

  const estimatedTokenCount = useMemo(() => {
    if (!draft) return 0;
    const fm = buildSkillEditorFrontmatter(draft);
    const fullContent = fm ? `---\n${fm}\n---\n\n${draft.body}` : draft.body;
    return estimateTokens(fullContent);
  }, [draft]);

  const updateDraft = useCallback(
    (updates: Partial<SkillEditorDraft>) => {
      if (!draft || savingRef.current) return;
      setDraft({ ...draft, ...updates });
    },
    [draft, setDraft]
  );

  const startCreate = useCallback(() => {
    if (!draft) {
      setSaveError(null);
      setValidationError(null);
      setDraft(createEmptySkillDraft());
    }
  }, [draft, setDraft]);

  const startEdit = useCallback(
    async (skill: InstalledSkill, content: string) => {
      const generation = ++editGeneration.current;
      setSaveError(null);
      setValidationError(null);
      const parsed = parseSkillEditorDocument(content);
      const workspacePath =
        skill.source === SKILL_SOURCE.WORKSPACE
          ? (skill.path.match(/^(.*)[\\/]\.orgii[\\/]skills[\\/]/)?.[1] ??
            options.workspacePath ??
            null)
          : null;
      if (skill.source === SKILL_SOURCE.WORKSPACE && !workspacePath) {
        throw new Error("Cannot locate the skill workspace");
      }

      let bundledFileDrafts: BundledFileDraft[] = [];
      if (skill.bundledFiles.length > 0) {
        const results = await invoke<
          Array<{ relativePath: string; content: string; error: string | null }>
        >("skills_read_files_batch", {
          skillName: skill.name,
          relativePaths: skill.bundledFiles,
          workspacePath,
        });
        bundledFileDrafts = results.map((r) => ({
          relativePath: r.relativePath,
          content: r.content,
          originalPath: r.relativePath,
          originalContent: r.error ? undefined : r.content,
          readError: r.error ?? undefined,
          binary: !r.error && !isTextFile(r.relativePath, r.content),
        }));
      }

      const onDiskScope =
        skill.source === SKILL_SOURCE.WORKSPACE
          ? SKILL_SCOPE.WORKSPACE
          : SKILL_SCOPE.GLOBAL;

      if (!mountedRef.current || generation !== editGeneration.current) return;
      setDraft({
        name: skill.name,
        originalFrontmatter: parsed.originalFrontmatter,
        workspacePath,
        description: parsed.description || skill.description,
        alwaysActive: parsed.alwaysActive,
        version: parsed.version,
        license: parsed.license,
        compatibility: parsed.compatibility,
        requiredBins: parsed.requiredBins,
        requiredEnv: parsed.requiredEnv,
        scope: onDiskScope,
        originalScope: onDiskScope,
        body: parsed.body,
        editingSkillPath: skill.path,
        editingSkillName: skill.name,
        bundledFileDrafts,
      });
    },
    [setDraft, options.workspacePath, mountedRef]
  );

  const validateName = useCallback(
    async (name: string): Promise<string | null> => {
      try {
        await invoke("skills_validate_name", { name, workspacePath: null });
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    []
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (!draft || savingRef.current) return false;
    savingRef.current = true;
    let savedDraft = draft;
    const replaceSavedDraft = (updates: Partial<SkillEditorDraft>) => {
      const previous = savedDraft;
      savedDraft = { ...savedDraft, ...updates };
      if (draftRef.current === previous) {
        draftRef.current = savedDraft;
        setDraft(savedDraft);
      }
    };

    setSaving(true);
    setSaveError(null);
    setValidationError(null);

    try {
      if (!draft.name.trim()) {
        setValidationError("Skill name is required");
        return false;
      }

      const frontmatter = buildSkillEditorFrontmatter(draft);
      const workspacePath =
        draft.scope === SKILL_SCOPE.WORKSPACE
          ? (draft.workspacePath ?? options.workspacePath ?? null)
          : null;

      if (draft.scope === SKILL_SCOPE.WORKSPACE && !workspacePath) {
        setValidationError("Cannot save a workspace skill without a workspace");
        return false;
      }

      if (isEditing && draft.editingSkillPath) {
        let writePath = draft.editingSkillPath;

        if (draft.originalScope && draft.originalScope !== draft.scope) {
          if (draft.scope === SKILL_SCOPE.WORKSPACE && !options.workspacePath) {
            setValidationError(
              "Cannot move skill to workspace scope: no workspace is open."
            );
            return false;
          }
          const movedPath = await invoke<string>("skills_move", {
            skillPath: draft.editingSkillPath,
            targetScope: draft.scope,
            workspacePath:
              draft.scope === SKILL_SCOPE.WORKSPACE
                ? (options.workspacePath ?? null)
                : null,
          });
          writePath = movedPath;
          replaceSavedDraft({
            editingSkillPath: movedPath,
            originalScope: draft.scope,
          });
        }

        await invoke("skills_update", {
          skillPath: writePath,
          frontmatter,
          body: draft.body,
        });
      } else {
        const nameError = await validateName(draft.name);
        if (nameError) {
          setValidationError(nameError);
          return false;
        }

        const created = await invoke<InstalledSkill>("skills_create", {
          name: draft.name,
          frontmatter,
          body: draft.body,
          workspacePath,
        });
        replaceSavedDraft({
          editingSkillPath: created.path,
          editingSkillName: draft.name,
          originalScope: draft.scope,
          workspacePath,
        });
      }

      const filesToWrite = draft.bundledFileDrafts.filter(
        (file) =>
          file.relativePath.trim() &&
          !file.readError &&
          !file.binary &&
          (file.originalPath !== file.relativePath ||
            file.originalContent !== file.content)
      );
      if (filesToWrite.length > 0) {
        const writeResults = await invoke<
          Array<{
            relativePath: string;
            success: boolean;
            error: string | null;
          }>
        >("skills_write_files_batch", {
          skillName: draft.name,
          files: filesToWrite.map((file) => ({
            relativePath: file.relativePath,
            content: file.content,
          })),
          workspacePath,
        });
        const completed = new Set(
          writeResults
            .filter((result) => result.success)
            .map((result) => result.relativePath)
        );
        replaceSavedDraft({
          bundledFileDrafts: savedDraft.bundledFileDrafts.map((file) =>
            completed.has(file.relativePath)
              ? {
                  ...file,
                  originalPath: file.relativePath,
                  originalContent: file.content,
                }
              : file
          ),
        });
        const failed = filesToWrite
          .filter((file) => !completed.has(file.relativePath))
          .map((file) => ({
            relativePath: file.relativePath,
            error:
              writeResults.find(
                (result) => result.relativePath === file.relativePath
              )?.error ?? "Missing write confirmation",
          }));
        if (failed.length > 0) {
          const summary = failed
            .map(
              (result) =>
                `${result.relativePath}: ${result.error ?? "unknown error"}`
            )
            .join("; ");
          throw new Error(
            `Failed to write ${failed.length} bundled file(s): ${summary}`
          );
        }
      }

      if (!mountedRef.current || draftRef.current !== savedDraft) return false;
      clearDraft();
      return true;
    } catch (err) {
      if (mountedRef.current && draftRef.current === savedDraft) {
        setSaveError(err instanceof Error ? err.message : String(err));
      }
      return false;
    } finally {
      savingRef.current = false;
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  }, [
    draft,
    isEditing,
    setDraft,
    validateName,
    clearDraft,
    options.workspacePath,
    mountedRef,
  ]);

  const discard = useCallback(() => {
    editGeneration.current += 1;
    draftRef.current = null;
    clearDraft();
    setSaveError(null);
    setValidationError(null);
  }, [clearDraft]);

  return {
    draft,
    isEditing,
    descriptionQuality,
    estimatedTokenCount,
    saving,
    saveError,
    validationError,
    updateDraft,
    startCreate,
    startEdit,
    save,
    discard,
    validateName,
  };
}
