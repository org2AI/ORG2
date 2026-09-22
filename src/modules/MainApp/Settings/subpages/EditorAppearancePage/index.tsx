/** Shared editor appearance sections rendered by the Appearance tab. */
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@/src/components/layout/Section";
import { useAtom } from "jotai";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import NumberInput from "@src/components/NumberInput";
import SegmentedTextPill from "@src/components/SegmentedTextPill";
import Select from "@src/components/Select";
import Switch from "@src/components/Switch";
import {
  ColorFileNamesFigure,
  DiffViewModeFigure,
  GitBlameFigure,
  HighlightActiveLineFigure,
  LineNumbersFigure,
  MinimapFigure,
  SplitDiffLineNumbersFigure,
  TreeIndentGuidesFigure,
  WordWrapFigure,
} from "@src/modules/MainApp/Settings/previews/editorPreviews";
import {
  LabelWithPreview,
  PreviewGrid,
  offOnPreview,
  previewItems,
  withDropdownOptionPreviews,
  withOptionPreviews,
} from "@src/modules/MainApp/Settings/previews/primitives";
import {
  CODE_FONT_FAMILIES,
  type CodeFontFamily,
  type EditorFontSize,
  type EditorLineHeight,
  type EditorLineNumbers,
  type EditorTabSize,
  codeFontFamilyAtom,
  customCodeFontFamilyAtom,
  editorAutoSaveAtom,
  editorFontSizeAtom,
  editorHighlightActiveLineAtom,
  editorLineHeightAtom,
  editorLineNumbersAtom,
  editorShowBlameAtom,
  editorShowMinimapAtom,
  editorShowTreeIndentGuidesAtom,
  editorSplitDiffCenteredLineNumbersAtom,
  editorTabSizeAtom,
  editorWordWrapAtom,
  gitSourceControlColorFileNamesAtom,
} from "@src/store/ui/editorSettingsAtom";
import { terminalFontSizeAtom } from "@src/store/ui/uiAtom";
import { diffViewModeAtom } from "@src/store/workstation/codeEditor/diffViewModeAtom";
import type { DiffViewMode } from "@src/types/git/types";

const CUSTOM_FONT_DEBOUNCE_MS = 3000;

// ============================================
// Theme & Typography Section
// ============================================

export const TypographySection: React.FC<{ showTitle?: boolean }> = ({
  showTitle = true,
}) => {
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");

  const [codeFontFamily, setCodeFontFamily] = useAtom(codeFontFamilyAtom);
  const [customFontFamily, setCustomFontFamily] = useAtom(
    customCodeFontFamilyAtom
  );
  const [fontSize, setFontSize] = useAtom(editorFontSizeAtom);
  const [tabSize, setTabSize] = useAtom(editorTabSizeAtom);
  const [lineHeight, setLineHeight] = useAtom(editorLineHeightAtom);
  // Local state for custom font name with debounce
  const [localCustomFont, setLocalCustomFont] = useState(customFontFamily);
  const customFontDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(() => {
    setLocalCustomFont(customFontFamily);
  }, [customFontFamily]);

  useEffect(() => {
    if (localCustomFont === customFontFamily) return;

    if (customFontDebounceRef.current) {
      clearTimeout(customFontDebounceRef.current);
    }

    customFontDebounceRef.current = setTimeout(() => {
      setCustomFontFamily(localCustomFont);
    }, CUSTOM_FONT_DEBOUNCE_MS);

    return () => {
      if (customFontDebounceRef.current) {
        clearTimeout(customFontDebounceRef.current);
      }
    };
  }, [localCustomFont, customFontFamily, setCustomFontFamily]);

  const handleFontFamilyChange = useCallback(
    (value: string | number | (string | number)[]) => {
      const fontValue = typeof value === "string" ? value : String(value);
      setCodeFontFamily(fontValue as CodeFontFamily);
    },
    [setCodeFontFamily]
  );

  return (
    <SectionContainer
      title={showTitle ? t("editor.themeTypography") : undefined}
    >
      <SectionRow
        settingsSearchKeys="editor.fontFamily"
        label={t("editor.fontFamily")}
      >
        <Select
          value={codeFontFamily}
          onChange={handleFontFamilyChange}
          options={CODE_FONT_FAMILIES.map((f) => {
            if (f.value === "system") {
              return { value: f.value, label: t("editor.fontFamilySystem") };
            }
            if (f.value === "custom") {
              return { value: f.value, label: t("editor.fontFamilyCustom") };
            }
            return f;
          })}
          showSearch
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>

      {codeFontFamily === "custom" && (
        <SectionRow
          settingsSearchKeys="editor.customFontFamily"
          label={t("editor.customFontName")}
          indent
        >
          <Input
            value={localCustomFont}
            onChange={setLocalCustomFont}
            placeholder="Fira Code"
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
      )}

      <SectionRow
        settingsSearchKeys="editor.fontSize"
        label={t("editor.fontSize")}
      >
        <NumberInput
          value={fontSize}
          min={10}
          max={24}
          step={1}
          suffix={tCommon("common.px")}
          controlsPosition="sides"
          onValueChange={(value) =>
            setFontSize((value ?? 13) as EditorFontSize)
          }
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>

      <SectionRow
        settingsSearchKeys="editor.lineHeight"
        label={t("editor.lineHeight")}
      >
        <NumberInput
          value={lineHeight}
          min={1.2}
          max={2.0}
          step={0.1}
          suffix={tCommon("common.multiplier")}
          controlsPosition="sides"
          onValueChange={(value) =>
            setLineHeight((value ?? 1.5) as EditorLineHeight)
          }
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>

      <SectionRow
        settingsSearchKeys="editor.tabSize"
        label={t("editor.tabSize")}
      >
        <NumberInput
          value={tabSize}
          min={2}
          max={8}
          step={2}
          suffix={tCommon("common.spaces")}
          controlsPosition="sides"
          onValueChange={(value) => setTabSize((value ?? 2) as EditorTabSize)}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
    </SectionContainer>
  );
};

// ============================================
// Terminal Section
// ============================================

export const TerminalSection: React.FC = () => {
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");
  const [terminalFontSize, setTerminalFontSize] = useAtom(terminalFontSizeAtom);

  return (
    <SectionContainer title={t("common:tabs.terminal")}>
      <SectionRow
        settingsSearchKeys="terminal.fontSize"
        label={t("editor.terminalFontSize")}
      >
        <NumberInput
          value={terminalFontSize}
          min={8}
          max={32}
          step={1}
          suffix={tCommon("common.px")}
          controlsPosition="sides"
          onValueChange={(value) => setTerminalFontSize(value ?? 13)}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
    </SectionContainer>
  );
};

// ============================================
// Editor Section (tree view + editor features)
// ============================================

export const FeaturesSection: React.FC = () => {
  const { t } = useTranslation("settings");

  const [showTreeIndentGuides, setShowTreeIndentGuides] = useAtom(
    editorShowTreeIndentGuidesAtom
  );
  const [lineNumbers, setLineNumbers] = useAtom(editorLineNumbersAtom);
  const [wordWrap, setWordWrap] = useAtom(editorWordWrapAtom);
  const [autoSave, setAutoSave] = useAtom(editorAutoSaveAtom);
  const [showMinimap, setShowMinimap] = useAtom(editorShowMinimapAtom);
  const [highlightActiveLine, setHighlightActiveLine] = useAtom(
    editorHighlightActiveLineAtom
  );
  const [splitDiffCenteredLineNumbers, setSplitDiffCenteredLineNumbers] =
    useAtom(editorSplitDiffCenteredLineNumbersAtom);
  // Same atoms as the file header / Source Control quick menus, so a change
  // on either surface is reflected on the other immediately.
  const [diffViewMode, setDiffViewMode] = useAtom(diffViewModeAtom);
  const [showBlame, setShowBlame] = useAtom(editorShowBlameAtom);
  const [colorFileNames, setColorFileNames] = useAtom(
    gitSourceControlColorFileNamesAtom
  );

  const handleLineNumbersChange = useCallback(
    (value: string | number | (string | number)[]) => {
      const mode = typeof value === "string" ? value : String(value);
      setLineNumbers(mode as EditorLineNumbers);
    },
    [setLineNumbers]
  );

  const lineNumbersOptions = useMemo(
    () =>
      [
        { value: "on", label: t("common:common.on") },
        { value: "off", label: t("common:common.off") },
        { value: "relative", label: t("editor.lineNumbersRelative") },
        { value: "interval", label: t("editor.lineNumbersInterval") },
      ] as const satisfies readonly {
        value: EditorLineNumbers;
        label: string;
      }[],
    [t]
  );
  const renderLineNumbersFigure = (mode: EditorLineNumbers) => (
    <LineNumbersFigure mode={mode} />
  );

  const diffViewModeOptions = [
    { value: "unified", label: t("common:workstation.unified") },
    { value: "split", label: t("common:workstation.split") },
  ] as const satisfies readonly { value: DiffViewMode; label: string }[];
  const renderDiffViewModeFigure = (mode: DiffViewMode) => (
    <DiffViewModeFigure mode={mode} />
  );

  return (
    <>
      <SectionContainer title={t("editor.tabEditor")}>
        <SectionRow
          settingsSearchKeys="editor.showTreeIndentGuides"
          label={
            <LabelWithPreview
              label={t("editor.treeIndentGuides")}
              preview={offOnPreview(TreeIndentGuidesFigure)}
            />
          }
        >
          <Switch
            checked={showTreeIndentGuides}
            onCheckedChange={setShowTreeIndentGuides}
          />
        </SectionRow>

        <SectionRow
          settingsSearchKeys="editor.lineNumbers"
          label={
            <LabelWithPreview
              label={t("editor.lineNumbers")}
              preview={
                <PreviewGrid
                  items={previewItems(
                    lineNumbersOptions,
                    renderLineNumbersFigure
                  )}
                />
              }
            />
          }
        >
          <Select
            value={lineNumbers}
            onChange={handleLineNumbersChange}
            options={withDropdownOptionPreviews(
              lineNumbersOptions,
              renderLineNumbersFigure
            )}
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>

        <SectionRow
          label={
            <LabelWithPreview
              label={t("editor.diffViewMode")}
              preview={
                <PreviewGrid
                  items={previewItems(
                    diffViewModeOptions,
                    renderDiffViewModeFigure
                  )}
                />
              }
            />
          }
        >
          <SegmentedTextPill<DiffViewMode>
            ariaLabel={t("editor.diffViewMode")}
            value={diffViewMode}
            onChange={setDiffViewMode}
            options={withOptionPreviews(
              diffViewModeOptions,
              renderDiffViewModeFigure
            )}
            size="large"
            dataTestId="diff-view-mode-select"
          />
        </SectionRow>

        <SectionRow
          settingsSearchKeys="editor.splitDiffCenteredLineNumbers"
          label={
            <LabelWithPreview
              label={t("editor.splitDiffCenteredLineNumbers")}
              preview={offOnPreview(SplitDiffLineNumbersFigure)}
            />
          }
        >
          <Switch
            checked={splitDiffCenteredLineNumbers}
            onCheckedChange={setSplitDiffCenteredLineNumbers}
          />
        </SectionRow>

        <SectionRow
          settingsSearchKeys="editor.wordWrap"
          label={
            <LabelWithPreview
              label={t("editor.wordWrap")}
              preview={offOnPreview(WordWrapFigure)}
            />
          }
        >
          <Switch checked={wordWrap} onCheckedChange={setWordWrap} />
        </SectionRow>

        <SectionRow
          settingsSearchKeys="editor.showMinimap"
          label={
            <LabelWithPreview
              label={t("editor.minimap")}
              preview={offOnPreview(MinimapFigure)}
            />
          }
        >
          <Switch checked={showMinimap} onCheckedChange={setShowMinimap} />
        </SectionRow>

        <SectionRow
          settingsSearchKeys="editor.highlightActiveLine"
          label={
            <LabelWithPreview
              label={t("editor.highlightActiveLine")}
              preview={offOnPreview(HighlightActiveLineFigure)}
            />
          }
        >
          <Switch
            checked={highlightActiveLine}
            onCheckedChange={setHighlightActiveLine}
          />
        </SectionRow>

        <SectionRow
          settingsSearchKeys="git.sourceControl.colorFileNames"
          label={
            <LabelWithPreview
              label={t("common:sidebarSettings.colorSourceControlFiles")}
              preview={offOnPreview(ColorFileNamesFigure)}
            />
          }
        >
          <Switch
            checked={colorFileNames}
            onCheckedChange={(checked) => {
              setColorFileNames(checked).catch(() => undefined);
            }}
            ariaLabel={t("common:sidebarSettings.colorSourceControlFiles")}
            dataTestId="color-source-control-files-switch"
          />
        </SectionRow>
      </SectionContainer>

      {/* Behavior toggles rather than display ones. */}
      <SectionContainer>
        <SectionRow
          settingsSearchKeys="editor.autoSave"
          label={t("editor.autoSave")}
        >
          <Switch checked={autoSave} onCheckedChange={setAutoSave} />
        </SectionRow>

        <SectionRow
          settingsSearchKeys="editor.showBlame"
          label={
            <LabelWithPreview
              label={t("editor.gitBlame")}
              preview={offOnPreview(GitBlameFigure)}
            />
          }
        >
          <Switch
            checked={showBlame}
            onCheckedChange={setShowBlame}
            ariaLabel={t("editor.gitBlame")}
            dataTestId="git-blame-switch"
          />
        </SectionRow>
      </SectionContainer>
    </>
  );
};
