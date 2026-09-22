/**
 * AppLockScreen — the password page shown over a locked app.
 *
 * Pure presentation plus the unlock request. It shows that agents are still
 * working (a count, never titles or content) so the user can tell from across
 * the room whether there is anything to come back for.
 */
import { useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  APP_LOCK_ERROR,
  APP_LOCK_MAX_PASSWORD_LENGTH,
  appLockApi,
  appLockErrorCode,
} from "@src/api/tauri/appLock";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
import { createLogger } from "@src/hooks/logger";
import { HugeiconsIcon, LockIcon } from "@src/icons";
import { appLockStateAtom } from "@src/store/appLock/appLockAtom";
import { workingSessionCountAtom } from "@src/store/session/sessionAtom/atoms";

import { formatRetryCountdown } from "./appLockFormat";

const logger = createLogger("AppLock");

type UnlockError = "incorrect" | "failed" | null;

/** Whole seconds left on the throttle, ticking down locally. */
function useRetryCountdown(retryAfterMs: number): number {
  const [deadline, setDeadline] = useState(() => Date.now() + retryAfterMs);
  const [remainingMs, setRemainingMs] = useState(retryAfterMs);

  useEffect(() => {
    setDeadline(Date.now() + retryAfterMs);
    setRemainingMs(retryAfterMs);
  }, [retryAfterMs]);

  useEffect(() => {
    if (remainingMs <= 0) return;
    const timer = window.setInterval(() => {
      setRemainingMs(Math.max(0, deadline - Date.now()));
    }, 250);
    return () => window.clearInterval(timer);
  }, [deadline, remainingMs]);

  return Math.ceil(remainingMs / 1000);
}

export const AppLockScreen: React.FC = () => {
  const { t } = useTranslation("settings");
  const state = useAtomValue(appLockStateAtom);
  const setState = useSetAtom(appLockStateAtom);
  const workingCount = useAtomValue(workingSessionCountAtom);

  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<UnlockError>(null);
  const [hintShown, setHintShown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const retryAfterMs = state === "unknown" ? 0 : state.retryAfterMs;
  const hint = state === "unknown" ? null : state.hint;
  const retrySeconds = useRetryCountdown(retryAfterMs);
  const throttled = retrySeconds > 0;

  // Runs after the field is enabled again; focusing from the submit handler
  // would hit a still-disabled input and drop focus.
  useEffect(() => {
    if (!throttled && !submitting) inputRef.current?.focus();
  }, [throttled, submitting]);

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (submitting || throttled || password.length === 0) return;
      setSubmitting(true);
      setError(null);
      appLockApi.unlock(password).then(
        (outcome) => {
          setState(outcome.status);
          if (!outcome.unlocked) {
            setError("incorrect");
            setPassword("");
          }
          setSubmitting(false);
        },
        (caught: unknown) => {
          const code = appLockErrorCode(caught);
          if (code === APP_LOCK_ERROR.THROTTLED) {
            // Another window used up the attempts; pick up the live delay.
            appLockApi.status().then(setState, () => setError("failed"));
          } else {
            logger.warn("unlock failed:", code ?? "unexpected error");
            setError("failed");
          }
          setPassword("");
          setSubmitting(false);
        }
      );
    },
    [password, setState, submitting, throttled]
  );

  const message = throttled
    ? t("appLock.screen.throttled", {
        time: formatRetryCountdown(retrySeconds),
      })
    : error === "incorrect"
      ? t("appLock.screen.incorrect")
      : error === "failed"
        ? t("appLock.screen.failed")
        : null;

  return (
    <div className="flex h-full w-full flex-col bg-bg-2">
      {/* Keeps the window movable; the traffic lights stay native. */}
      <div
        data-tauri-drag-region
        className="h-[36px] shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      <div className="flex flex-1 items-center justify-center px-6">
        <form
          onSubmit={handleSubmit}
          className="flex w-full max-w-[320px] flex-col items-center"
          autoComplete="off"
        >
          <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-fill-2 text-text-1">
            <HugeiconsIcon icon={LockIcon} size={26} />
          </div>

          <h1 className="text-center text-lg font-semibold text-text-1">
            {t("appLock.screen.title")}
          </h1>

          {/* No button: Enter submits the form (a default action, so it works
              even though the input guard stops key events propagating). */}
          <div className="mt-5 w-full">
            <Input
              ref={inputRef}
              type="password"
              size="default"
              shape="round"
              value={password}
              onChange={setPassword}
              placeholder={t("appLock.screen.passwordPlaceholder")}
              aria-label={t("appLock.screen.passwordPlaceholder")}
              aria-invalid={error !== null}
              aria-describedby="app-lock-message"
              error={error !== null && !throttled}
              disabled={throttled || submitting}
              maxLength={APP_LOCK_MAX_PASSWORD_LENGTH}
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          <p
            id="app-lock-message"
            role="status"
            aria-live="polite"
            className={`mt-3 min-h-5 text-center text-xs ${
              throttled ? "text-text-3" : "text-danger-6"
            }`}
          >
            {message}
          </p>

          {/* Revealed on request rather than printed on the page: the hint is
              for the owner who is stuck, not for whoever walks past. */}
          {hint !== null &&
            (hintShown ? (
              <p
                className="mt-1 max-w-full text-center text-xs text-text-2"
                style={{ overflowWrap: "anywhere" }}
              >
                {t("appLock.screen.hint", { hint })}
              </p>
            ) : (
              <Button
                className="mt-1"
                variant="tertiary"
                size="small"
                htmlType="button"
                onClick={() => setHintShown(true)}
              >
                {t("appLock.screen.showHint")}
              </Button>
            ))}
        </form>
      </div>

      {/* A footer, not part of the centered column: sessions starting and
          finishing must not make the password field jump. */}
      <div className="flex h-[36px] shrink-0 items-center justify-center">
        {workingCount > 0 && (
          <p className="flex items-center gap-2 text-xs text-text-3">
            <span className="size-1.5 animate-agent-pulse rounded-full bg-success-6" />
            {t("appLock.screen.working", { count: workingCount })}
          </p>
        )}
      </div>
    </div>
  );
};
