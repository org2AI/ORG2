/**
 * App Lock Settings Section
 *
 * Set, change or remove the password that locks the app windows, lock now, and
 * choose when the app locks by itself. All state is owned by Rust
 * (`system_services::app_lock`) and mirrored in `appLockStateAtom`; this
 * section only renders it and sends requests.
 *
 * Returns content only — the Settings page shell renders the section title
 * and wraps this in the scroll container.
 */
import { useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  APP_LOCK_AUTO_LOCK_MINUTES,
  APP_LOCK_ERROR,
  APP_LOCK_MAX_HINT_LENGTH,
  APP_LOCK_MAX_PASSWORD_LENGTH,
  APP_LOCK_MIN_PASSWORD_LENGTH,
  type AppLockStatus,
  appLockApi,
  appLockErrorCode,
} from "@src/api/tauri/appLock";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
import Message from "@src/components/Message";
import Select from "@src/components/Select";
import Switch from "@src/components/Switch";
import {
  SECTION_ACTION_GAP_CLASSES,
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/components/layout/Section";
import { HintWithInfo } from "@src/components/layout/blocks/HintWithInfo";
import { CURRENT_SHORTCUT_PLATFORM } from "@src/config/keyboard/shortcutBindings";
import { createLogger } from "@src/hooks/logger";
import { HugeiconsIcon, LockIcon } from "@src/icons";
import { appLockStateAtom } from "@src/store/appLock/appLockAtom";

import ShortcutRecorder from "./ShortcutsSection/ShortcutRecorder";

/** Catalog id of the lock shortcut (`config/keyboard/shortcuts`). */
const LOCK_SHORTCUT_ID = "lock_app";

const logger = createLogger("AppLock");

/** Which password form is open. */
type PasswordForm = "set" | "change" | "remove" | null;

/**
 * Validate the new-password pair before it is sent. Returns the i18n key of
 * the problem, or `null` when the pair is acceptable. Length is counted in
 * characters to match the Rust check.
 */
export function validateNewPassword(
  password: string,
  confirmation: string
): "appLock.errors.tooShort" | "appLock.errors.mismatch" | null {
  if (Array.from(password).length < APP_LOCK_MIN_PASSWORD_LENGTH) {
    return "appLock.errors.tooShort";
  }
  if (password !== confirmation) return "appLock.errors.mismatch";
  return null;
}

/** i18n key for a rejected app-lock command. */
export function appLockErrorMessageKey(error: unknown): string {
  switch (appLockErrorCode(error)) {
    case APP_LOCK_ERROR.INVALID_PASSWORD:
      return "appLock.errors.incorrectCurrent";
    case APP_LOCK_ERROR.THROTTLED:
      return "appLock.errors.throttled";
    case APP_LOCK_ERROR.PASSWORD_TOO_SHORT:
      return "appLock.errors.tooShort";
    case APP_LOCK_ERROR.PASSWORD_TOO_LONG:
      return "appLock.errors.tooLong";
    case APP_LOCK_ERROR.HINT_TOO_LONG:
      return "appLock.errors.hintTooLong";
    case APP_LOCK_ERROR.HINT_REVEALS_PASSWORD:
      return "appLock.errors.hintRevealsPassword";
    default:
      return "appLock.errors.generic";
  }
}

/**
 * Editable hint. Keyed by the saved hint from the parent, so a save (here or
 * in another window) resets the draft without an effect.
 */
const HintField: React.FC<{
  savedHint: string;
  onSave: (hint: string) => Promise<string | null>;
}> = ({ savedHint, onSave }) => {
  const { t } = useTranslation("settings");
  const [draft, setDraft] = useState(savedHint);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = (value: string) => {
    setSaving(true);
    onSave(value).then(
      (message) => {
        setError(message);
        setSaving(false);
      },
      () => setSaving(false)
    );
  };

  return (
    <Input
      value={draft}
      onChange={(value) => {
        setDraft(value);
        setError(null);
      }}
      savedValue={savedHint}
      onConfirm={confirm}
      onCancel={() => {
        setDraft(savedHint);
        setError(null);
      }}
      confirmLoading={saving}
      errorMessage={error ?? undefined}
      placeholder={t("appLock.hintPlaceholder")}
      aria-label={t("appLock.hint")}
      maxLength={APP_LOCK_MAX_HINT_LENGTH}
      autoComplete="off"
      style={SECTION_CONTROL_STYLE}
    />
  );
};

const AppLockSection: React.FC = () => {
  const { t } = useTranslation("settings");
  const state = useAtomValue(appLockStateAtom);
  const setState = useSetAtom(appLockStateAtom);

  const [form, setForm] = useState<PasswordForm>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [hintDraft, setHintDraft] = useState("");
  const [recordingShortcut, setRecordingShortcut] = useState<string | null>(
    null
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const closeForm = useCallback(() => {
    setForm(null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
    setHintDraft("");
    setFormError(null);
  }, []);

  const openForm = useCallback(
    (next: Exclude<PasswordForm, null>) => {
      closeForm();
      setForm(next);
    },
    [closeForm]
  );

  const run = useCallback(
    (request: () => Promise<AppLockStatus>, successKey: string) => {
      setSaving(true);
      setFormError(null);
      request().then(
        (status) => {
          setState(status);
          closeForm();
          Message.success(t(successKey));
          setSaving(false);
        },
        (error: unknown) => {
          logger.warn(
            "request rejected:",
            appLockErrorCode(error) ?? "unexpected error"
          );
          setFormError(t(appLockErrorMessageKey(error)));
          setSaving(false);
        }
      );
    },
    [closeForm, setState, t]
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (saving || form === null) return;
      if (form === "remove") {
        run(
          () => appLockApi.clearPassword(currentPassword),
          "appLock.passwordRemoved"
        );
        return;
      }
      const problem = validateNewPassword(newPassword, confirmation);
      if (problem) {
        setFormError(t(problem, { count: APP_LOCK_MIN_PASSWORD_LENGTH }));
        return;
      }
      run(
        () =>
          appLockApi.setPassword(newPassword, {
            currentPassword: form === "change" ? currentPassword : undefined,
            hint: hintDraft,
          }),
        form === "change" ? "appLock.passwordChanged" : "appLock.passwordSet"
      );
    },
    [
      confirmation,
      currentPassword,
      form,
      hintDraft,
      newPassword,
      run,
      saving,
      t,
    ]
  );

  const updatePreferences = useCallback(
    (lockOnLaunch: boolean, autoLockMinutes: number) => {
      appLockApi
        .updatePreferences(lockOnLaunch, autoLockMinutes)
        .then(setState, (error: unknown) => {
          logger.warn(
            "preferences rejected:",
            appLockErrorCode(error) ?? "unexpected error"
          );
          Message.error(t("appLock.errors.generic"));
        });
    },
    [setState, t]
  );

  /** Returns the message to show under the field, or `null` on success. */
  const saveHint = useCallback(
    async (hint: string): Promise<string | null> => {
      try {
        setState(await appLockApi.setHint(hint));
        return null;
      } catch (error) {
        logger.warn(
          "hint rejected:",
          appLockErrorCode(error) ?? "unexpected error"
        );
        return t(appLockErrorMessageKey(error));
      }
    },
    [setState, t]
  );

  const handleLockNow = useCallback(() => {
    appLockApi.lock().then(setState, (error: unknown) => {
      logger.warn("lock rejected:", appLockErrorCode(error) ?? "unexpected");
      Message.error(t("appLock.errors.generic"));
    });
  }, [setState, t]);

  if (state === "unknown") return null;

  const { enabled, lockOnLaunch, autoLockMinutes } = state;
  const savedHint = state.hint ?? "";
  const needsCurrent = form === "change" || form === "remove";
  const needsNew = form === "set" || form === "change";

  const autoLockOptions = APP_LOCK_AUTO_LOCK_MINUTES.map((minutes) => ({
    value: minutes,
    label:
      minutes === 0
        ? t("appLock.autoLockNever")
        : minutes === 60
          ? t("appLock.autoLockHour")
          : t("appLock.autoLockMinutes", { count: minutes }),
  }));

  return (
    <>
      <SectionContainer>
        <SectionRow
          label={
            <span className="inline-flex items-center gap-1">
              {t("appLock.password")}
              <HintWithInfo content={t("appLock.scopeNote")} position="right" />
            </span>
          }
        >
          <div className={SECTION_ACTION_GAP_CLASSES}>
            {enabled ? (
              <>
                <Button
                  onClick={() => openForm("change")}
                  disabled={form === "change"}
                >
                  {t("appLock.changePassword")}
                </Button>
                <Button
                  tone="danger"
                  onClick={() => openForm("remove")}
                  disabled={form === "remove"}
                >
                  {t("appLock.removePassword")}
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                onClick={() => openForm("set")}
                disabled={form === "set"}
              >
                {t("appLock.setPassword")}
              </Button>
            )}
          </div>
        </SectionRow>

        {form !== null && (
          <SectionRow layout="vertical" indent>
            <form
              onSubmit={handleSubmit}
              className="flex max-w-[320px] flex-col gap-2"
              autoComplete="off"
              data-testid="app-lock-password-form"
            >
              {needsCurrent && (
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  placeholder={t("appLock.currentPassword")}
                  aria-label={t("appLock.currentPassword")}
                  maxLength={APP_LOCK_MAX_PASSWORD_LENGTH}
                  autoComplete="off"
                  autoFocus
                />
              )}
              {needsNew && (
                <>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={setNewPassword}
                    placeholder={t("appLock.newPassword")}
                    aria-label={t("appLock.newPassword")}
                    maxLength={APP_LOCK_MAX_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    autoFocus={!needsCurrent}
                  />
                  <Input
                    type="password"
                    value={confirmation}
                    onChange={setConfirmation}
                    placeholder={t("appLock.confirmPassword")}
                    aria-label={t("appLock.confirmPassword")}
                    maxLength={APP_LOCK_MAX_PASSWORD_LENGTH}
                    autoComplete="new-password"
                  />
                  <Input
                    value={hintDraft}
                    onChange={setHintDraft}
                    placeholder={t("appLock.hintOptionalPlaceholder")}
                    aria-label={t("appLock.hint")}
                    maxLength={APP_LOCK_MAX_HINT_LENGTH}
                    autoComplete="off"
                  />
                </>
              )}
              {formError && (
                <span role="alert" className="text-xs text-danger-6">
                  {formError}
                </span>
              )}
              <div className={SECTION_ACTION_GAP_CLASSES}>
                <Button
                  variant="primary"
                  tone={form === "remove" ? "danger" : undefined}
                  htmlType="submit"
                  loading={saving}
                >
                  {form === "remove"
                    ? t("appLock.removePassword")
                    : t("common:actions.save")}
                </Button>
                <Button htmlType="button" onClick={closeForm} disabled={saving}>
                  {t("common:actions.cancel")}
                </Button>
              </div>
            </form>
          </SectionRow>
        )}
      </SectionContainer>

      {enabled && (
        <SectionContainer>
          <SectionRow
            label={t("appLock.lockNow")}
            description={t("appLock.lockNowDesc")}
          >
            <Button
              onClick={handleLockNow}
              icon={<HugeiconsIcon icon={LockIcon} size={14} />}
            >
              {t("appLock.lockNow")}
            </Button>
          </SectionRow>
          <SectionRow label={t("appLock.shortcut")}>
            <div className="flex justify-end">
              <ShortcutRecorder
                id={LOCK_SHORTCUT_ID}
                command={t("appLock.lockNow")}
                platform={CURRENT_SHORTCUT_PLATFORM}
                recording={recordingShortcut === LOCK_SHORTCUT_ID}
                onRecord={setRecordingShortcut}
                actions="visible"
              />
            </div>
          </SectionRow>
          <SectionRow label={t("appLock.hint")}>
            <HintField
              key={savedHint}
              savedHint={savedHint}
              onSave={saveHint}
            />
          </SectionRow>
          <SectionRow
            label={t("appLock.autoLock")}
            description={t("appLock.autoLockDesc")}
          >
            <Select
              ariaLabel={t("appLock.autoLock")}
              value={autoLockMinutes}
              onChange={(value) => {
                if (typeof value === "number") {
                  updatePreferences(lockOnLaunch, value);
                }
              }}
              options={autoLockOptions}
              style={SECTION_CONTROL_STYLE}
            />
          </SectionRow>
          <SectionRow
            label={t("appLock.lockOnLaunch")}
            description={t("appLock.lockOnLaunchDesc")}
          >
            <Switch
              checked={lockOnLaunch}
              onCheckedChange={(checked) =>
                updatePreferences(checked, autoLockMinutes)
              }
            />
          </SectionRow>
        </SectionContainer>
      )}
    </>
  );
};

export default AppLockSection;
