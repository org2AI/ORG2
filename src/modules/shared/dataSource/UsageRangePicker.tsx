import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import SelectGhostTrigger from "@src/components/Select/SelectGhostTrigger";
import TimePicker from "@src/components/TimePicker";

import {
  USAGE_RANGE_PRESETS,
  type UsageRange,
  parseCustomUsageRange,
  resolveUsageRange,
  toLocalDateTime,
} from "./usageRange";

interface UsageRangePickerProps {
  value: UsageRange;
  onChange: (range: UsageRange) => void;
}

/** Draft fields stay local: only Apply changes the dashboard's query scope. */
export default function UsageRangePicker({
  value,
  onChange,
}: UsageRangePickerProps) {
  const { t, i18n } = useTranslation("sessions", {
    keyPrefix: "kanban.dataSource.usage",
  });
  const { t: tCommon } = useTranslation("common");
  const id = useId();
  const [open, setOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const customTriggerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ start: string; end: string } | null>(
    null
  );
  const custom = typeof value !== "string";
  const parsed = draft ? parseCustomUsageRange(draft.start, draft.end) : null;
  const openEditor = () => {
    const now = Date.now();
    const resolved = resolveUsageRange(value, now);
    setDraft({
      start: `${toLocalDateTime(resolved.startMs ?? now - 86_400_000).slice(0, 13)}:00`,
      end: `${toLocalDateTime(resolved.endMs ?? now).slice(0, 13)}:00`,
    });
  };
  const formatBound = (ms: number) =>
    new Date(ms).toLocaleString(i18n.resolvedLanguage || i18n.language, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
    });
  const label = custom
    ? `${formatBound(value.startMs)} – ${formatBound(value.endMs)}`
    : undefined;

  return (
    <>
      <Dropdown
        popupVisible={open || !!draft}
        onVisibleChange={(visible) => {
          setOpen(visible);
          if (!visible && draft) setDraft(null);
        }}
        className={`${DROPDOWN_CLASSES.panel} ${DROPDOWN_WIDTHS.wideMenuClass} w-max`}
        position="bottom-start"
        getPopupContainer={() => document.body}
        avoidViewportOverflow
        additionalInsideRefs={[editorRef]}
        keyboardNavigation={!draft}
        value={custom ? "custom" : value}
        onSelect={(next) => {
          if (next === "custom") {
            openEditor();
            return;
          }
          const preset = USAGE_RANGE_PRESETS.find((item) => item === next);
          if (preset) onChange(preset);
        }}
        options={[
          ...USAGE_RANGE_PRESETS.map((preset) => ({
            value: preset,
            label: t(`range.${preset}`),
          })),
          {
            value: "custom",
            label: t("range.custom"),
            dataTestId: "usage-custom-range-option",
          },
        ]}
        dropdownRender={(menu) => (
          <div role="presentation" onClick={(event) => event.stopPropagation()}>
            <Dropdown
              className={DROPDOWN_CLASSES.panel}
              position="right-start"
              getPopupContainer={() => document.body}
              avoidViewportOverflow
              popupVisible={!!draft}
              onVisibleChange={() => {}}
              options={[]}
              keyboardNavigation={false}
              dropdownRender={() =>
                draft ? (
                  <div
                    ref={editorRef}
                    role="presentation"
                    onClick={(event) => event.stopPropagation()}
                    data-testid="usage-custom-range-dropdown"
                    className="flex w-64 max-w-full flex-col gap-3 p-3"
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        setDraft(null);
                        setOpen(true);
                        customTriggerRef.current?.focus();
                      }
                    }}
                  >
                    {(["start", "end"] as const).map((bound) => (
                      <TimePicker
                        key={bound}
                        aria-label={t(`customRange.${bound}`)}
                        mode="datetime"
                        autoFocus={bound === "start"}
                        required
                        value={draft![bound]}
                        onChange={(next) =>
                          setDraft({ ...draft!, [bound]: next })
                        }
                        aria-describedby={!parsed ? `${id}-error` : undefined}
                        aria-invalid={!parsed}
                        className="w-full min-w-0"
                      />
                    ))}
                    {!parsed && (
                      <p
                        id={`${id}-error`}
                        role="alert"
                        className="text-xs text-danger-6"
                      >
                        {t("customRange.invalid")}
                      </p>
                    )}
                    <div className="flex justify-end gap-2 border-t border-border-2 pt-3">
                      <Button
                        size="small"
                        appearance="ghost"
                        onClick={() => {
                          setDraft(null);
                          setOpen(true);
                          customTriggerRef.current?.focus();
                        }}
                      >
                        {t("customRange.cancel")}
                      </Button>
                      <Button
                        size="small"
                        variant="primary"
                        disabled={!parsed}
                        onClick={() => {
                          if (!parsed) return;
                          onChange(parsed);
                          setDraft(null);
                          setOpen(false);
                        }}
                      >
                        {tCommon("actions.apply")}
                      </Button>
                    </div>
                  </div>
                ) : null
              }
            >
              <div ref={customTriggerRef} tabIndex={-1}>
                {menu}
              </div>
            </Dropdown>
          </div>
        )}
      >
        <SelectGhostTrigger
          value={t(`range.${custom ? "custom" : value}`)}
          open={open || !!draft}
        />
      </Dropdown>
      {custom && (
        <Button
          appearance="ghost"
          size="small"
          onClick={() => {
            setOpen(true);
            openEditor();
          }}
          title={label}
          aria-label={`${t("range.custom")}: ${label}`}
        >
          <span className="max-w-64 truncate text-xs tabular-nums">
            {label}
          </span>
        </Button>
      )}
    </>
  );
}
