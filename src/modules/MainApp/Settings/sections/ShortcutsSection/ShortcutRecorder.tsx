import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  KEYBOARD_SHORTCUT_VARIANT,
  KeyboardShortcut,
} from "@src/components/KeyboardShortcut";
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

/**
 * In the Shortcuts table the edit / reset buttons stay out of the way until
 * the row is hovered or focused — a hundred pencils would be noise. A lone
 * recorder in a settings row has no such crowd, so it can ask for them to be
 * shown as ordinary, always-visible buttons.
 */
const HOVER_REVEAL_CLASSES =
  "opacity-0 group-focus-within/shortcut-row:opacity-100 group-hover/shortcut-row:opacity-100 focus-visible:opacity-100";

export default function ShortcutRecorder({
  id,
  command,
  platform,
  recording,
  onRecord,
  actions = "hover",
}: {
  id: string;
  command: string;
  platform: ShortcutPlatform;
  recording: boolean;
  onRecord: (id: string | null) => void;
  /** `"visible"` keeps the edit / reset buttons on screen as secondary buttons. */
  actions?: "hover" | "visible";
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
  const actionsVisible = actions === "visible";
  if (!canCustomizeShortcut(id))
    return (
      <KeyboardShortcut
        shortcut={keys}
        variant={KEYBOARD_SHORTCUT_VARIANT.prominent}
      />
    );
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-2">
        <KeyboardShortcut
          shortcut={keys}
          variant={KEYBOARD_SHORTCUT_VARIANT.prominent}
        />
        <Button
          ref={buttonRef}
          className={
            recording || actionsVisible ? undefined : HOVER_REVEAL_CLASSES
          }
          size="small"
          variant={recording || actionsVisible ? "secondary" : "tertiary"}
          iconOnly={!recording}
          icon={
            recording ? undefined : (
              <HugeiconsIcon
                icon={PencilEdit02Icon}
                data-icon="edit-shortcut"
                size={14}
              />
            )
          }
          aria-label={t("shortcuts.editCommand", { command })}
          aria-pressed={recording}
          onClick={() => {
            setError("");
            onRecord(id);
          }}
        >
          {recording ? t("shortcuts.pressShortcut") : null}
        </Button>
        {recording ? (
          <Button
            variant="tertiary"
            size="small"
            onClick={() => onRecord(null)}
          >
            {t("common:actions.cancel")}
          </Button>
        ) : (
          getOverride(id, platform) && (
            <Button
              variant={actionsVisible ? "secondary" : "tertiary"}
              size="small"
              className={actionsVisible ? undefined : HOVER_REVEAL_CLASSES}
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
