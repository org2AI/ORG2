/**
 * Find & Replace Panel for CodeMirror
 *
 * Shared floating FindCard with editor-owned queries and replacement
 * - Cmd+F scope cycling through the shared coordinator
 * - Cmd+H for Replace
 * - Regex support
 * - Case-sensitive toggle
 * - Whole word match toggle
 * - Match counter
 * - Next/Previous navigation
 */
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import { Extension, Facet, StateEffect, StateField } from "@codemirror/state";
import { EditorView, Panel, ViewPlugin } from "@codemirror/view";
import React from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import {
  getOverride,
  matchesDefaultShortcut,
  matchesShortcut,
} from "@src/config/keyboard/shortcutBindings";
import { createLogger } from "@src/hooks/logger";
import {
  DEBOUNCE_DELAYS,
  useDebouncedCallback,
} from "@src/hooks/perf/useDebouncedCallback";
import { HugeiconsIcon, ReplaceAllIcon, ReplaceIcon } from "@src/icons";
import FindCard from "@src/scaffold/GlobalSpotlight/FindCard";
import {
  type FindTarget,
  adoptFindTarget,
  closeFindTarget,
  registerFindTarget,
} from "@src/scaffold/GlobalSpotlight/FindCard/findCoordinator";
import { SpotlightSearchBar } from "@src/scaffold/GlobalSpotlight/components/SpotlightSearchBar";
import { SPOTLIGHT_TOKENS } from "@src/scaffold/GlobalSpotlight/constants";
import { getFileName } from "@src/util/file/pathUtils";

const findFileName = Facet.define<string, string>({
  combine: (values) => values[0] ?? "",
});

const log = createLogger("CodeMirrorSearchPanel");

// ============================================
// Types
// ============================================

interface SearchState {
  /** Whether replace section is expanded */
  replaceMode: boolean;
}

// ============================================
// State Effects
// ============================================

const toggleReplaceEffect = StateEffect.define<boolean>();

// ============================================
// Search State Field (minimal - just for replace mode)
// ============================================

const searchStateField = StateField.define<SearchState>({
  create: () => ({
    replaceMode: false,
  }),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(toggleReplaceEffect)) {
        return { ...value, replaceMode: effect.value };
      }
    }
    return value;
  },
});

// ============================================
// Search Actions
// ============================================

/**
 * Apply search query to editor
 */
function applySearch(
  view: EditorView,
  query: string,
  replaceText: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  useRegex: boolean
) {
  try {
    const searchQueryObj = new SearchQuery({
      search: query,
      caseSensitive,
      regexp: useRegex,
      wholeWord,
      replace: replaceText,
    });

    view.dispatch({
      effects: setSearchQuery.of(searchQueryObj),
    });
  } catch (error) {
    log.error("Search error:", error);
  }
}

/**
 * Get match count for current search
 */
function getMatchCount(view: EditorView): { current: number; total: number } {
  const query = getSearchQuery(view.state);
  if (!query || !query.valid) {
    return { current: 0, total: 0 };
  }

  let total = 0;
  let current = 0;
  const cursorPos = view.state.selection.main.head;
  let foundCurrent = false;

  const iter = query.getCursor(view.state.doc);
  let next = iter.next();
  while (!next.done) {
    total++;
    // Check if cursor is within or at the start of this match
    if (
      !foundCurrent &&
      next.value.from <= cursorPos &&
      cursorPos <= next.value.to
    ) {
      current = total;
      foundCurrent = true;
    }
    // If cursor is before this match and we haven't found current yet, this is the next match
    if (!foundCurrent && cursorPos < next.value.from) {
      current = total;
      foundCurrent = true;
    }
    next = iter.next();
  }

  // If cursor is after all matches, current is 0 (or could be set to total)
  if (!foundCurrent && total > 0) {
    current = 1; // Wrap to first match
  }

  return { current, total };
}

// ============================================
// Search Panel Component
// ============================================

interface SearchPanelProps {
  view: EditorView;
  initialReplaceMode?: boolean;
}

const SearchPanel: React.FC<SearchPanelProps> = ({
  view,
  initialReplaceMode = false,
}) => {
  const { t } = useTranslation();
  const replaceInputRef = React.useRef<HTMLInputElement>(null);
  // Get current search query from CodeMirror
  const currentQuery = getSearchQuery(view.state);

  const [localQuery, setLocalQuery] = React.useState(
    currentQuery?.search || ""
  );
  const [localReplace, setLocalReplace] = React.useState(
    currentQuery?.replace || ""
  );
  const [localCaseSensitive, setLocalCaseSensitive] = React.useState(
    currentQuery?.caseSensitive || false
  );
  const [localWholeWord, setLocalWholeWord] = React.useState(
    currentQuery?.wholeWord || false
  );
  const [localUseRegex, setLocalUseRegex] = React.useState(
    currentQuery?.regexp || false
  );
  const [localReplaceMode, setLocalReplaceMode] =
    React.useState(initialReplaceMode);
  const [matchCount, setMatchCount] = React.useState({ current: 0, total: 0 });

  // Debounced search - waits 500ms after user stops typing for large file performance
  const debouncedApplySearch = useDebouncedCallback(() => {
    applySearch(
      view,
      localQuery,
      localReplace,
      localCaseSensitive,
      localWholeWord,
      localUseRegex
    );
    const count = getMatchCount(view);
    setMatchCount(count);
  }, DEBOUNCE_DELAYS.EXPENSIVE);

  React.useEffect(() => {
    debouncedApplySearch();
  }, [
    localQuery,
    localReplace,
    localCaseSensitive,
    localWholeWord,
    localUseRegex,
    debouncedApplySearch,
  ]);

  // Update replace mode in state (no debounce needed)
  React.useEffect(() => {
    view.dispatch({
      effects: toggleReplaceEffect.of(localReplaceMode),
    });
  }, [localReplaceMode, view]);

  const handleClose = () => {
    // Close the search panel using CodeMirror's close function
    closeSearchPanel(view);
    view.focus();
  };

  const handleToggleReplace = () => {
    setLocalReplaceMode(!localReplaceMode);
  };

  const runAction = (action: (view: EditorView) => boolean) => {
    debouncedApplySearch.flush();
    action(view);
    setMatchCount(getMatchCount(view));
  };
  const readOnly =
    view.state.readOnly || !view.state.facet(EditorView.editable);

  return (
    <FindCard
      scope="file"
      targetName={view.state.facet(findFileName)}
      onReplaceShortcut={readOnly ? undefined : handleToggleReplace}
      search={{
        query: localQuery,
        setQuery: setLocalQuery,
        isSearching: false,
        isSearchVisible: true,
        resultCount: matchCount.total,
        currentResultIndex: matchCount.current - 1,
        nextResult: () => runAction(findNext),
        prevResult: () => runAction(findPrevious),
        closeSearch: handleClose,
        caseSensitive: localCaseSensitive,
        toggleCaseSensitive: () => setLocalCaseSensitive((value) => !value),
        wholeWord: localWholeWord,
        toggleWholeWord: () => setLocalWholeWord((value) => !value),
        useRegex: localUseRegex,
        toggleRegex: () => setLocalUseRegex((value) => !value),
      }}
      extraControls={
        !readOnly && (
          <ToolbarTooltip label={t("tooltips.replaceLabel")}>
            <Button
              variant="tertiary"
              className="aria-pressed:bg-surface-selected aria-pressed:text-primary-6"
              size="small"
              iconOnly
              aria-pressed={localReplaceMode}
              onClick={handleToggleReplace}
              icon={
                <>
                  <HugeiconsIcon icon={ReplaceIcon} size={14} />
                  <span className="sr-only">{t("tooltips.replaceLabel")}</span>
                </>
              }
            />
          </ToolbarTooltip>
        )
      }
    >
      {localReplaceMode && !readOnly && (
        <SpotlightSearchBar
          density="compact"
          inputRef={replaceInputRef}
          path={[]}
          searchQuery={localReplace}
          onSearchQueryChange={setLocalReplace}
          placeholder={`${t("actions.replace")}...`}
          leadingSlot={
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-text-2">
              <HugeiconsIcon
                icon={ReplaceIcon}
                size={SPOTLIGHT_TOKENS.iconSize}
              />
            </span>
          }
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (localQuery) runAction(replaceNext);
            }
          }}
          trailingSlot={
            <div className="flex items-center gap-px">
              {[
                {
                  label: t("tooltips.replaceLabel"),
                  icon: ReplaceIcon,
                  action: replaceNext,
                  name: "replace",
                },
                {
                  label: t("tooltips.replaceAllLabel"),
                  icon: ReplaceAllIcon,
                  action: replaceAll,
                  name: "replace-all",
                },
              ].map(({ label, icon, action, name }) => (
                <ToolbarTooltip key={name} label={label}>
                  <Button
                    variant="tertiary"
                    size="small"
                    iconOnly
                    disabled={!localQuery}
                    onClick={() => runAction(action)}
                    icon={
                      <>
                        <HugeiconsIcon icon={icon} data-icon={name} size={14} />
                        <span className="sr-only">{label}</span>
                      </>
                    }
                  />
                </ToolbarTooltip>
              ))}
            </div>
          }
        />
      )}
    </FindCard>
  );
};

// ============================================
// Panel Factory
// ============================================

const editorFindTargets = new WeakMap<EditorView, FindTarget>();
const findTargetPlugin = ViewPlugin.fromClass(
  class {
    unregister: () => void;
    constructor(view: EditorView) {
      const target: FindTarget = {
        scope: "file",
        element: () => view.dom,
        open: () => {
          openSearchPanel(view);
        },
        close: () => {
          closeSearchPanel(view);
        },
      };
      editorFindTargets.set(view, target);
      this.unregister = registerFindTarget(target);
    }
    destroy() {
      this.unregister();
    }
  }
);

function createSearchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cm-search-panel-wrapper";
  // The CodeMirror panel is a lifecycle anchor only; the card floats outside
  // its scrolling/panel layout and never reduces the editor viewport.
  dom.style.display = "none";
  const overlay = document.createElement("div");
  overlay.className = "pointer-events-none absolute top-2 right-2 left-2 z-50";
  overlay.style.fontFamily = "var(--app-font-family)";
  const content = document.createElement("div");
  content.className = "pointer-events-auto ml-auto w-full max-w-sm";
  overlay.append(content);
  const root = createRoot(content);
  const target = editorFindTargets.get(view);
  return {
    dom,
    top: true,
    mount() {
      const host =
        view.dom.closest<HTMLElement>("[data-pane-surface-underlay]") ??
        view.dom.closest<HTMLElement>(
          "[data-chat-panel], [data-workbench-surface]"
        ) ??
        view.dom;
      host.append(overlay);
      if (target) adoptFindTarget(target);
      root.render(
        <SearchPanel
          view={view}
          initialReplaceMode={
            view.state.field(searchStateField, false)?.replaceMode ?? false
          }
        />
      );
    },
    destroy() {
      if (target) closeFindTarget(target);
      overlay.remove();
      queueMicrotask(() => root.unmount());
    },
  };
}

// ============================================
// Keyboard Shortcuts
// ============================================

const searchKeymap = EditorView.domEventHandlers({
  keydown(event, view) {
    // Cmd+H - Toggle find & replace
    if (matchesShortcut(event, "find_replace")) {
      event.preventDefault();
      if (searchPanelOpen(view.state)) {
        closeSearchPanel(view);
        view.focus();
      } else {
        view.dispatch({
          effects: toggleReplaceEffect.of(true),
        });
        openSearchPanel(view);
      }
      return true;
    }

    if (
      ["find", "find_replace"].some(
        (id) => getOverride(id) && matchesDefaultShortcut(event, id)
      )
    ) {
      event.preventDefault();
      return true;
    }
    return false;
  },
});

// ============================================
// Extension Export
// ============================================

/**
 * Find & Replace extension with keyboard shortcuts
 *
 * This includes:
 * - The search() extension from CodeMirror for highlighting
 * - Our custom panel (which replaces the default panel)
 * - Keyboard shortcuts
 */
export function findReplaceExtension(filePath?: string): Extension {
  return [
    findFileName.of(filePath ? getFileName(filePath) : ""),
    // Include CodeMirror's search extension with custom panel
    search({
      createPanel: createSearchPanel,
    }),
    // Our state field for managing panel state
    searchStateField,
    findTargetPlugin,
    // Keyboard shortcuts
    searchKeymap,
  ];
}
