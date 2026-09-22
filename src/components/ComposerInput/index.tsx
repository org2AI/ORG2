/**
 * ComposerInput
 *
 * Drop-in replacement for the legacy ProseMirror input.
 * The editor surface is a single `contenteditable` host; pills
 * are mounted as `contenteditable="false"` spans with React Portals
 * rendering the `ComposerPill` UI inside each span. Selection, IME, and
 * caret behavior are delegated to the browser; the heavy logic lives in
 * `useEditorOperations`, `keyboard.ts`, `pasteHandlers.ts`, and
 * `imperativeApi.ts`.
 *
 * The component exposes the shared `ComposerInputRef` contract, so every
 * existing consumer (`useComposerInput`, `useSlashCommand`, `useDraftManagement`,
 * `inputPreparation`, …) keeps working without any signature changes.
 */
import { useAtomValue } from "jotai";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import { createLogger } from "@src/hooks/logger";
import { installedSkillsAtom } from "@src/store/skills/installedSkillsAtom";
import {
  findBrowserSessionByUrl,
  loadBrowserPillContent,
} from "@src/util/contextPillContent";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import { createInputHandler } from "./composerInput.inputHandler";
import { useComposerNativeEvents } from "./composerInput.nativeEvents";
import { useComposerPillPortals } from "./composerInput.pillPortals";
import { createCutHandler } from "./cutHandler";
import { buildImperativeApi } from "./imperativeApi";
import "./index.scss";
import { type MentionState, createKeyDownHandler } from "./keyboard";
import {
  createDropHandler,
  createPasteHandler,
  pillForUrl,
} from "./pasteHandlers";
import {
  caretTextOffset,
  placeCaretAtEnd,
  placeCaretAtPoint,
  placeCaretAtTextOffset,
  rangeInsideHost,
} from "./selection";
import { removeSnapshotTextRange } from "./snapshotRanges";
import type {
  ComposerInputProps,
  ComposerInputRef,
  ComposerPillAttrs,
} from "./types";
import { useEditorOperations } from "./useEditorOperations";
import { PILL_DATA_ATTR, extractPlainText } from "./utils";

export type { ComposerInputRef, ComposerSnapshot, PillIconType } from "./types";

const logger = createLogger("ComposerInput");

/**
 * The browser pill for a URL that is the page open in an in-app browser
 * session — the same pill, and the same content load, as @-mentioning the tab.
 */
function resolveBrowserPill(url: string): ComposerPillAttrs | null {
  const session = findBrowserSessionByUrl(url);
  if (!session) return null;
  const pillPath = `browser://${session.sessionId}/${Date.now()}`;
  loadBrowserPillContent(session.sessionId, pillPath);
  return {
    filePath: pillPath,
    fileName: session.title || "Browser Tab",
    isFolder: false,
    iconType: "browser",
    lineStart: null,
    lineEnd: null,
  };
}
/** Attribute marking a pill host span — read-only surfaces route clicks on it. */
export { serializePillNode } from "./utils";

const IME_COMPOSITION_END_ENTER_GRACE_MS = 30;

const ComposerInput = forwardRef<ComposerInputRef, ComposerInputProps>(
  function ComposerInput(props, ref) {
    const {
      placeholder = "Type your message...",
      ariaLabel,
      trailingHint = null,
      initialContent = "",
      onContentChange,
      onAtMention,
      onAtMentionClose,
      onSubmit,
      requireCmdEnter = true,
      autoFocus = false,
      className = "",
      minHeight = 60,
      maxHeight = 200,
      overflowY,
      editable = true,
      onKeyDownForDropdown,
      onSlashCommand,
      onSlashCommandClose,
      onKeyDownForSlashDropdown,
      onInputMouseDown,
      onImagePaste,
      slashTriggerMode = "command",
    } = props;

    const { isDark } = useCurrentTheme();
    const installedSkills = useAtomValue(installedSkillsAtom);
    const skillPathByName = useMemo(() => {
      const map = new Map<string, string>();
      for (const skill of installedSkills) {
        map.set(skill.name, skill.path);
        map.set(`/${skill.name}`, skill.path);
      }
      return map;
    }, [installedSkills]);
    const installedSkillsRef = useRef(installedSkills);
    installedSkillsRef.current = installedSkills;

    const ops = useEditorOperations();
    const { hostRef, pillEntries } = ops;

    // ===== Stale-closure-proof callback refs =====
    const onContentChangeRef = useRef(onContentChange);
    const onAtMentionRef = useRef(onAtMention);
    const onAtMentionCloseRef = useRef(onAtMentionClose);
    const onSubmitRef = useRef(onSubmit);
    const onKeyDownForDropdownRef = useRef(onKeyDownForDropdown);
    const onSlashCommandRef = useRef(onSlashCommand);
    const onSlashCommandCloseRef = useRef(onSlashCommandClose);
    const onKeyDownForSlashDropdownRef = useRef(onKeyDownForSlashDropdown);
    const onInputMouseDownRef = useRef(onInputMouseDown);
    const onImagePasteRef = useRef(onImagePaste);
    useEffect(() => {
      onContentChangeRef.current = onContentChange;
      onAtMentionRef.current = onAtMention;
      onAtMentionCloseRef.current = onAtMentionClose;
      onSubmitRef.current = onSubmit;
      onKeyDownForDropdownRef.current = onKeyDownForDropdown;
      onSlashCommandRef.current = onSlashCommand;
      onSlashCommandCloseRef.current = onSlashCommandClose;
      onKeyDownForSlashDropdownRef.current = onKeyDownForSlashDropdown;
      onInputMouseDownRef.current = onInputMouseDown;
      onImagePasteRef.current = onImagePaste;
    });

    // ===== Composition + mention state =====
    const isComposingRef = useRef(false);
    const compositionEndedAtRef = useRef(0);
    const pendingCaretAfterPillRef = useRef(false);
    const atMentionRef = useRef<MentionState>({
      active: false,
      startOffset: 0,
    });
    const slashCommandRef = useRef<MentionState>({
      active: false,
      startOffset: 0,
    });
    const atMentionOpenedAtRef = useRef(0);
    const slashCommandOpenedAtRef = useRef(0);

    const setAtMentionState = useCallback((state: MentionState) => {
      if (state.active && slashCommandRef.current.active) {
        slashCommandRef.current = { active: false, startOffset: 0 };
        onSlashCommandCloseRef.current?.();
      }
      atMentionRef.current = state;
      if (state.active) atMentionOpenedAtRef.current = performance.now();
    }, []);
    const setSlashCommandState = useCallback((state: MentionState) => {
      if (state.active && atMentionRef.current.active) {
        atMentionRef.current = { active: false, startOffset: 0 };
        onAtMentionCloseRef.current?.();
      }
      slashCommandRef.current = state;
      if (state.active) slashCommandOpenedAtRef.current = performance.now();
    }, []);

    // ===== Mention/slash reset helper =====
    const resetMentionState = useCallback(() => {
      atMentionRef.current = { active: false, startOffset: 0 };
      slashCommandRef.current = { active: false, startOffset: 0 };
      onAtMentionCloseRef.current?.();
      onSlashCommandCloseRef.current?.();
    }, []);

    // ===== Text/empty state cache =====
    const isEmptyRef = useRef(true);
    const [hostIsEmpty, setHostIsEmpty] = React.useState(true);

    const updateEmptyState = useCallback(() => {
      const empty = ops.isHostEmpty();
      if (empty !== isEmptyRef.current) {
        isEmptyRef.current = empty;
        setHostIsEmpty(empty);
      }
    }, [ops]);

    // ===== Mention-driven update handler =====
    const updateCoveredPillSelection = useCallback(() => {
      const host = hostRef.current;
      if (!host) return;
      const pills = host.querySelectorAll<HTMLElement>(`[${PILL_DATA_ATTR}]`);
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        pills.forEach((pill) => pill.classList.remove("is-selection-covered"));
        return;
      }
      const range = selection.getRangeAt(0);
      if (!host.contains(range.commonAncestorContainer)) {
        pills.forEach((pill) => pill.classList.remove("is-selection-covered"));
        return;
      }
      pills.forEach((pill) => {
        pill.classList.toggle(
          "is-selection-covered",
          range.intersectsNode(pill)
        );
      });
    }, [hostRef]);

    const handleInput = useMemo(
      () =>
        createInputHandler({
          host: () => hostRef.current,
          reconcilePillsFromDom: ops.reconcilePillsFromDom,
          commitHistoryBoundary: ops.commitHistoryBoundary,
          clearHost: ops.clearHost,
          updateEmptyState,
          getOnContentChange: () => onContentChangeRef.current,
          getAtMention: () => atMentionRef.current,
          setAtMention: setAtMentionState,
          markAtMentionOpened: () => {
            atMentionOpenedAtRef.current = performance.now();
          },
          getAtMentionOpenedAt: () => atMentionOpenedAtRef.current,
          getOnAtMention: () => onAtMentionRef.current,
          getOnAtMentionClose: () => onAtMentionCloseRef.current,
          getSlashCommand: () => slashCommandRef.current,
          setSlashCommand: setSlashCommandState,
          markSlashCommandOpened: () => {
            slashCommandOpenedAtRef.current = performance.now();
          },
          getSlashCommandOpenedAt: () => slashCommandOpenedAtRef.current,
          getOnSlashCommand: () => onSlashCommandRef.current,
          getOnSlashCommandClose: () => onSlashCommandCloseRef.current,
        }),
      [hostRef, ops, setAtMentionState, setSlashCommandState, updateEmptyState]
    );

    // ===== Stable handlers =====
    const handleInputRef = useRef(handleInput);
    handleInputRef.current = handleInput;
    const handlePaste = useMemo(
      () =>
        createPasteHandler({
          insertPill: (attrs) => {
            pendingCaretAfterPillRef.current = true;
            ops.insertPill(attrs);
          },
          insertTextAtCaret: ops.insertTextAtCaret,
          getOnImagePaste: () => onImagePasteRef.current,
          getInstalledSkills: () => installedSkillsRef.current,
          resolveBrowserPill,
          // The WebKit-sanitizer recovery path finishes after an IPC round
          // trip, so the synchronous `paste` wrapper has already closed its
          // history boundary. Open a fresh one around the awaited work and
          // notify on completion, making the recovered paste a single undo.
          runDeferred: (work) => {
            const finish = () => {
              ops.commitHistoryBoundary();
              handleInputRef.current?.();
            };
            ops.markHistoryBoundary();
            // Close the history step whichever way the work settles, so a
            // failed native read can never leave a boundary open.
            work().then(finish, (error: unknown) => {
              logger.warn("Deferred paste did not complete:", error);
              finish();
            });
          },
        }),
      [ops]
    );

    const handleDrop = useMemo(
      () =>
        createDropHandler({
          insertPill: (attrs) => {
            pendingCaretAfterPillRef.current = true;
            ops.insertPill(attrs);
            updateEmptyState();
            const host = hostRef.current;
            if (host) onContentChangeRef.current?.(extractPlainText(host));
          },
        }),
      [hostRef, ops, updateEmptyState]
    );

    const handleCut = useMemo(
      () =>
        createCutHandler({
          markHistoryBoundary: ops.markHistoryBoundary,
          reconcilePillsFromDom: ops.reconcilePillsFromDom,
          // The handler cancels the native cut, so the browser never sends
          // its `deleteByCut` input. Report it as one, so a cut that empties
          // the editor settles it the way deleting everything does.
          onAfterCut: () =>
            handleInput(new InputEvent("input", { inputType: "deleteByCut" })),
        }),
      [ops.markHistoryBoundary, ops.reconcilePillsFromDom, handleInput]
    );

    // Wrap `insertNewline` so a bare-Enter / Shift+Enter newline still
    // flows through the same notify-host path that native typing does.
    // The op mutates the DOM directly (no `beforeinput`/`input` event),
    // so without this the parent never sees the new `\n`.
    const autolinkUrlBeforeCaret = useCallback(
      () =>
        ops.autolinkUrlBeforeCaret((url) =>
          pillForUrl(url, "", resolveBrowserPill)
        ),
      [ops]
    );
    const insertNewlineAndNotify = useCallback(() => {
      // A line break ends the word before it, so an address typed just before
      // Enter links the same way it does before a space.
      const linked = autolinkUrlBeforeCaret();
      if (ops.insertNewline() || linked) handleInput();
    }, [ops, handleInput, autolinkUrlBeforeCaret]);

    const undoAndNotify = useCallback(() => {
      const restored = ops.undo();
      if (restored) handleInput();
      return restored;
    }, [ops, handleInput]);

    const redoAndNotify = useCallback(() => {
      const restored = ops.redo();
      if (restored) handleInput();
      return restored;
    }, [ops, handleInput]);

    const handleKeyDown = useMemo(
      () =>
        createKeyDownHandler({
          host: () => hostRef.current,
          isComposing: (event) => {
            if (
              event.isComposing ||
              isComposingRef.current ||
              event.keyCode === 229
            ) {
              return true;
            }
            return (
              event.key === "Enter" &&
              performance.now() - compositionEndedAtRef.current <
                IME_COMPOSITION_END_ENTER_GRACE_MS
            );
          },
          getAtMention: () => atMentionRef.current,
          setAtMention: setAtMentionState,
          getSlashCommand: () => slashCommandRef.current,
          setSlashCommand: setSlashCommandState,
          getOnKeyDownForDropdown: () => onKeyDownForDropdownRef.current,
          getOnKeyDownForSlashDropdown: () =>
            onKeyDownForSlashDropdownRef.current,
          getOnAtMention: () => onAtMentionRef.current,
          getOnAtMentionClose: () => onAtMentionCloseRef.current,
          getOnSlashCommand: () => onSlashCommandRef.current,
          getOnSlashCommandClose: () => onSlashCommandCloseRef.current,
          getOnSubmit: () => onSubmitRef.current,
          getText: () => {
            const host = hostRef.current;
            return host ? extractPlainText(host) : "";
          },
          insertNewline: insertNewlineAndNotify,
          markHistoryBoundary: ops.markHistoryBoundary,
          undo: undoAndNotify,
          redo: redoAndNotify,
          requireCmdEnter,
          slashTriggerMode,
        }),
      [
        hostRef,
        insertNewlineAndNotify,
        ops.markHistoryBoundary,
        redoAndNotify,
        requireCmdEnter,
        setAtMentionState,
        setSlashCommandState,
        slashTriggerMode,
        undoAndNotify,
      ]
    );

    // ===== Native event wiring =====
    useComposerNativeEvents({
      hostRef,
      ops,
      isComposingRef,
      compositionEndedAtRef,
      handlePaste,
      handleDrop,
      handleCut,
      handleKeyDown,
      handleInput,
      undoAndNotify,
      redoAndNotify,
      updateCoveredPillSelection,
      autolinkUrlBeforeCaret,
    });

    // ===== Initial content + autoFocus =====
    // Layout effects: seeded content and the caret must be on screen in the
    // first painted frame. As passive effects they ran after it, so the
    // composer flashed empty and unfocused, then jumped.
    useLayoutEffect(() => {
      if (!initialContent) return;
      ops.setHostContent(initialContent);
      updateEmptyState();
      onContentChangeRef.current?.(initialContent);
      if (autoFocus) {
        const host = hostRef.current;
        if (host) placeCaretAtEnd(host);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- initialContent is mount-owned editor seed data; later changes must use the imperative setContent path so an ordinary parent render cannot overwrite user edits
    }, []);

    useLayoutEffect(() => {
      if (!autoFocus) return;
      const host = hostRef.current;
      if (host) placeCaretAtEnd(host);
    }, [autoFocus, hostRef]);

    // ===== Imperative handle =====
    useImperativeHandle(
      ref,
      () =>
        buildImperativeApi({
          host: () => hostRef.current,
          insertPill: (attrs) => {
            pendingCaretAfterPillRef.current = true;
            ops.insertPill(attrs);
            updateEmptyState();
            const host = hostRef.current;
            if (host) onContentChangeRef.current?.(extractPlainText(host));
          },
          insertTextAtCaret: (text) => {
            ops.insertTextAtCaret(text);
            updateEmptyState();
            const host = hostRef.current;
            if (host) onContentChangeRef.current?.(extractPlainText(host));
          },
          setHostContent: (content) => {
            resetMentionState();
            ops.setHostContent(content);
            updateEmptyState();
            onContentChangeRef.current?.(content);
          },
          restoreSnapshot: (snapshot) => {
            resetMentionState();
            ops.restoreSnapshot(snapshot);
            updateEmptyState();
            const host = hostRef.current;
            if (host) onContentChangeRef.current?.(extractPlainText(host));
          },
          captureSnapshot: () => ops.captureSnapshot(),
          markHistoryBoundary: ops.markHistoryBoundary,
          commitHistoryBoundary: ops.commitHistoryBoundary,
          clearHost: () => {
            resetMentionState();
            ops.clearHost();
            updateEmptyState();
            onContentChangeRef.current?.("");
          },
          focusHost: ops.focusHost,
          placeCaretAtPoint: (x, y) => {
            const host = hostRef.current;
            return host ? placeCaretAtPoint(host, x, y) : false;
          },
          removePillByPath: (filePath) => {
            ops.removePillByPath(filePath);
            updateEmptyState();
            const host = hostRef.current;
            if (host) onContentChangeRef.current?.(extractPlainText(host));
          },
          isHostEmpty: ops.isHostEmpty,
          isInlineMenuActive: () =>
            atMentionRef.current.active || slashCommandRef.current.active,
          triggerAtMention: () => {
            const host = hostRef.current;
            if (!host) return;
            host.focus();
            const range = rangeInsideHost(host);
            const caretOffset = caretTextOffset(host, range);
            setAtMentionState({
              active: true,
              startOffset: caretOffset,
              hasAtChar: false,
            });
            const rect = range.getBoundingClientRect();
            onAtMentionRef.current?.("", {
              x: rect.left,
              y: rect.bottom,
            });
          },
          getSlashCommandState: () => ({
            active: slashCommandRef.current.active,
            hasTriggerChar: slashCommandRef.current.hasTriggerChar,
          }),
          closeSlashCommand: () => {
            slashCommandRef.current = { active: false, startOffset: 0 };
            onSlashCommandCloseRef.current?.();
          },
          consumeSlashCommandQuery: () => {
            const host = hostRef.current;
            if (!host) return;
            const slashCommand = slashCommandRef.current;
            if (!slashCommand.active) return;
            const range = rangeInsideHost(host);
            const caretOffset = caretTextOffset(host, range);
            const startOffset = Math.max(
              0,
              slashCommand.startOffset - (slashCommand.hasTriggerChar ? 1 : 0)
            );
            const snapshot = ops.captureSnapshot();
            ops.restoreSnapshot(
              removeSnapshotTextRange(snapshot, startOffset, caretOffset)
            );
            placeCaretAtTextOffset(host, startOffset);
          },
          getAtMentionState: () => ({
            active: atMentionRef.current.active,
            hasAtChar: atMentionRef.current.hasAtChar,
          }),
          closeAtMention: () => {
            atMentionRef.current = { active: false, startOffset: 0 };
            onAtMentionCloseRef.current?.();
          },
          consumeMentionQuery: () => {
            const host = hostRef.current;
            if (!host) return;
            const mention = atMentionRef.current;
            if (!mention.active) return;
            const range = rangeInsideHost(host);
            const caretOffset = caretTextOffset(host, range);
            const startOffset = Math.max(
              0,
              mention.startOffset - (mention.hasAtChar ? 1 : 0)
            );
            const snapshot = ops.captureSnapshot();
            ops.restoreSnapshot(
              removeSnapshotTextRange(snapshot, startOffset, caretOffset)
            );
            placeCaretAtTextOffset(host, startOffset);
          },
        }),
      [hostRef, ops, resetMentionState, setAtMentionState, updateEmptyState]
    );

    // ===== Pill portal targets =====
    const pillPortals = useComposerPillPortals({
      ops,
      pillEntries,
      skillPathByName,
      updateEmptyState,
      onContentChangeRef,
      pendingCaretAfterPillRef,
    });

    return (
      <div
        className={`composer-input ${isDark ? "dark" : "light"} ${className}`}
        style={{
          minHeight,
          maxHeight,
          overflowY: overflowY ?? "auto",
        }}
      >
        <div className="composer-input-wrapper">
          <div
            ref={hostRef}
            className={`composer-input-content ${isDark ? "dark" : "light"} ${
              hostIsEmpty ? "is-empty" : ""
            } ${trailingHint && !hostIsEmpty ? "has-trailing-hint" : ""}`}
            contentEditable={editable}
            aria-label={ariaLabel}
            suppressContentEditableWarning
            data-placeholder={placeholder}
            data-trailing-hint={
              trailingHint && !hostIsEmpty ? trailingHint : undefined
            }
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onInput={(event) => handleInput(event.nativeEvent)}
            onMouseDown={() => onInputMouseDownRef.current?.()}
          />
        </div>
        {pillPortals}
      </div>
    );
  }
);

ComposerInput.displayName = "ComposerInput";

export default ComposerInput;
