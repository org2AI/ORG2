import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import KeyBadge from "@src/components/KeyBadge";
import { syncNativeShortcuts } from "@src/config/keyboard/nativeShortcutSync";
import {
  type ShortcutPlatform,
  bindingFromEvent,
  canCustomizeShortcut,
  findShortcutConflict,
  getOverride,
  resetShortcutBindings,
  setRecordingShortcut,
  setShortcutBinding,
} from "@src/config/keyboard/shortcutBindings";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { useShortcutBindings } from "@src/config/keyboard/useShortcutBindings";
import { HugeiconsIcon, PencilEdit02Icon } from "@src/icons";

export default function ShortcutRecorder({
  id,
  command,
  platform,
  recording,
  onRecord,
}: {
  id: string;
  command: string;
  platform: ShortcutPlatform;
  recording: boolean;
  onRecord: (id: string | null) => void;
}) {
  const { t } = useTranslation("settings");
  useShortcutBindings();
  const [error, setError] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!recording) return;
    let ready = false;
    let active = true;
    setRecordingShortcut(true);
    void syncNativeShortcuts()
      .then(() => {
        ready = true;
      })
      .catch(() => {
        if (active) {
          setError(t("shortcuts.nativeSyncFailed"));
          onRecord(null);
        }
      });
    const stop = () => {
      onRecord(null);
      buttonRef.current?.focus();
    };
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape" || event.key === "Tab") {
        stop();
        return;
      }
      if (event.repeat || !ready) return;
      const binding = bindingFromEvent(event);
      if (!binding) return;
      if (
        !(binding.ctrl || binding.meta || binding.alt) &&
        !/^F\d+$/.test(binding.key)
      ) {
        setError(t("shortcuts.requireModifier"));
        return;
      }
      const conflict = findShortcutConflict(id, platform, binding);
      if (conflict) {
        setError(t("shortcuts.conflict", { command: conflict }));
        return;
      }
      try {
        setShortcutBinding(id, platform, binding);
        setError("");
        stop();
      } catch {
        setError(t("shortcuts.saveFailed"));
      }
    };
    window.addEventListener("keydown", capture, true);
    window.addEventListener("blur", stop);
    return () => {
      active = false;
      setRecordingShortcut(false);
      void syncNativeShortcuts().catch(() =>
        setError(t("shortcuts.nativeSyncFailed"))
      );
      window.removeEventListener("keydown", capture, true);
      window.removeEventListener("blur", stop);
    };
  }, [recording, id, platform, t, onRecord]);
  const keys = getShortcutKeys(id, { platform });
  if (!canCustomizeShortcut(id))
    return <KeyBadge keys={keys} showSeparator={false} />;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-2">
        <KeyBadge keys={keys} showSeparator={false} />
        <Button
          ref={buttonRef}
          className={
            recording
              ? undefined
              : "opacity-0 group-focus-within/shortcut-row:opacity-100 group-hover/shortcut-row:opacity-100 focus-visible:opacity-100"
          }
          size="small"
          appearance={recording ? "outline" : "ghost"}
          iconOnly={!recording}
          aria-label={t("shortcuts.editCommand", { command })}
          aria-pressed={recording}
          onClick={() => {
            setError("");
            onRecord(id);
          }}
        >
          {recording ? (
            t("shortcuts.pressShortcut")
          ) : (
            <HugeiconsIcon icon={PencilEdit02Icon} size={14} />
          )}
        </Button>
        {recording ? (
          <Button
            size="small"
            appearance="ghost"
            onClick={() => onRecord(null)}
          >
            {t("common:actions.cancel")}
          </Button>
        ) : (
          getOverride(id, platform) && (
            <Button
              size="small"
              appearance="ghost"
              className="opacity-0 group-focus-within/shortcut-row:opacity-100 group-hover/shortcut-row:opacity-100 focus-visible:opacity-100"
              onClick={() => {
                try {
                  resetShortcutBindings(platform, id);
                  setError("");
                } catch {
                  setError(t("shortcuts.saveFailed"));
                }
              }}
            >
              {t("shortcuts.reset")}
            </Button>
          )
        )}
      </div>
      {error && (
        <span role="alert" className="text-xs text-danger-6">
          {error}
        </span>
      )}
    </div>
  );
}
