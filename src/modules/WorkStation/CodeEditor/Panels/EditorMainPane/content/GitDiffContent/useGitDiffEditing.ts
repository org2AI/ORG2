import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { writeTextFileSerial } from "@src/services/file/writeTextFileSerial";
import {
  acknowledgeGitDiffSave,
  deleteGitDiffEditDraft,
  getGitDiffEditDraftBaseline,
  restoreGitDiffEditDraft,
  setGitDiffEditDraft,
} from "@src/store/workstation/codeEditor/gitDiffEditDrafts";

interface Owner {
  active: boolean;
  filePath: string | undefined;
}
interface Snapshot {
  owner: Owner;
  content: string | null;
  baseline: string | undefined;
  pending: number;
}

/** Buffer, saved baseline and in-flight saves belong to one mounted document. */
export function useGitDiffEditing(
  filePath: string | undefined,
  diskContent: string | undefined,
  onSaved: () => void,
  onError: (error: unknown) => void
) {
  const owner = useMemo<Owner>(() => ({ active: false, filePath }), [filePath]);
  const [state, setState] = useState<Snapshot>({
    owner,
    content: null,
    baseline: undefined,
    pending: 0,
  });
  const current = useRef(state);
  const publish = useCallback((next: Snapshot) => {
    // Event-boundary publication also covers edit + save completion in one batch.
    current.current = next;
    setState(next);
  }, []);

  useLayoutEffect(() => {
    owner.active = true;
    return () => {
      owner.active = false;
    };
  }, [owner]);

  useLayoutEffect(() => {
    const previous = current.current;
    if (previous.owner !== owner || previous.baseline === undefined) {
      publish({
        owner,
        content:
          filePath && diskContent !== undefined
            ? restoreGitDiffEditDraft(filePath, diskContent)
            : null,
        baseline: diskContent,
        pending: 0,
      });
    } else if (
      previous.content === null &&
      previous.pending === 0 &&
      previous.baseline !== diskContent
    ) {
      publish({ ...previous, baseline: diskContent });
    }
  }, [owner, filePath, diskContent, publish]);

  const edit = useCallback(
    (content: string) => {
      const previous = current.current;
      if (!owner.active || previous.owner !== owner || !filePath) return;
      const baseline =
        getGitDiffEditDraftBaseline(filePath) ?? previous.baseline;
      publish({ ...previous, content, baseline });
      setGitDiffEditDraft(filePath, baseline ?? "", content);
    },
    [owner, filePath, publish]
  );

  const discard = useCallback(() => {
    const previous = current.current;
    if (!owner.active || previous.owner !== owner || !filePath) return;
    const baseline = getGitDiffEditDraftBaseline(filePath) ?? previous.baseline;
    deleteGitDiffEditDraft(filePath);
    publish({ ...previous, content: null, baseline });
  }, [owner, filePath, publish]);

  const save = useCallback(async () => {
    const saved = current.current;
    if (
      !owner.active ||
      saved.owner !== owner ||
      !filePath ||
      saved.content === null ||
      saved.content === saved.baseline
    )
      return;
    publish({ ...saved, pending: saved.pending + 1 });
    try {
      await writeTextFileSerial(filePath, saved.content);
      // Disk changed even if the editor closed. Rebase surviving newer drafts
      // so remount does not discard them against the newly saved disk content.
      acknowledgeGitDiffSave(
        filePath,
        saved.content,
        owner.active && current.current.owner === owner
      );
      if (!owner.active || current.current.owner !== owner) return;
      const latest = current.current;
      const content = latest.content ?? latest.baseline ?? "";
      publish({ ...latest, content, baseline: saved.content });
      // Discard while saving is a new revert intent. Ordinary edits are already
      // in the shared cache; do not overwrite another mounted pane's draft.
      if (
        latest.content === null &&
        getGitDiffEditDraftBaseline(filePath) === undefined
      ) {
        setGitDiffEditDraft(filePath, saved.content, content);
      }
      onSaved();
    } catch (error) {
      if (owner.active && current.current.owner === owner) onError(error);
    } finally {
      if (owner.active && current.current.owner === owner) {
        const latest = current.current;
        publish({ ...latest, pending: latest.pending - 1 });
      }
    }
  }, [owner, filePath, publish, onSaved, onError]);

  const visible = state.owner === owner ? state : null;
  return {
    editedContent: visible?.content ?? visible?.baseline ?? null,
    hasUnsavedChanges:
      visible?.content != null && visible.content !== visible.baseline,
    saving: (visible?.pending ?? 0) > 0,
    edit,
    discard,
    save,
  };
}
