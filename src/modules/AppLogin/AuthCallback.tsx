import { getDefaultStore } from "jotai";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { exchangeSupabaseCodeForSession } from "@src/api/http/auth/supabase";
import { ROUTES } from "@src/config/routes";
import {
  HOSTED_LOGIN_ENABLED,
  SERVICE_AUTH_STORAGE_KEYS,
  clearProcessedCode,
  isCodeAlreadyProcessed,
  markCodeAsProcessed,
  parseAuthCallback,
} from "@src/config/serviceAuth";
import {
  hostedTokenAtom,
  serviceAuthAtom,
  serviceExpiryAtom,
  serviceValidatedAtom,
} from "@src/hooks/auth";
import { createLogger } from "@src/hooks/logger";
import { useAppNavigate as useNavigate } from "@src/hooks/navigation/useAppNavigate";

import { LoginLoadingState } from "./index";

const log = createLogger("AuthCallback");
const AUTH_SUCCESS_REDIRECT_DELAY_MS = 2000;

const AuthCallback: React.FC = () => {
  const { t } = useTranslation("market");
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const safeTimeout = (fn: () => void, ms: number) => {
      const timer = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
      timers.push(timer);
    };

    const redirectFromFailedCallback = () => {
      safeTimeout(() => {
        navigate(
          HOSTED_LOGIN_ENABLED
            ? ROUTES.auth.login.path
            : ROUTES.workStation.base.path,
          { replace: true }
        );
      }, 2000);
    };

    const redirectFromSuccessfulCallback = (redirectPath: string) => {
      setIsComplete(true);
      safeTimeout(() => {
        navigate(redirectPath, { replace: true });
      }, AUTH_SUCCESS_REDIRECT_DELAY_MS);
    };

    const handleCallback = async () => {
      if (isProcessingRef.current) {
        return;
      }

      const search = location.search;

      if (!search) {
        log.error("No query params found in URL");
        setError(t("market.auth.noAuthCode"));
        redirectFromFailedCallback();
        return;
      }

      const result = parseAuthCallback(search);

      if (result.error) {
        log.error("Supabase auth error:", result.error);
        setError(result.error);
        redirectFromFailedCallback();
        return;
      }

      if (!result.code) {
        log.error("No authorization code in response");
        setError(t("market.auth.noAuthCode"));
        redirectFromFailedCallback();
        return;
      }

      const alreadyProcessed = await isCodeAlreadyProcessed(result.code);
      if (cancelled) return;
      if (alreadyProcessed) {
        const existingToken = localStorage.getItem(
          SERVICE_AUTH_STORAGE_KEYS.accessToken
        );
        if (existingToken) {
          const storedRedirect = sessionStorage.getItem("login_redirect");
          sessionStorage.removeItem("login_redirect");
          const redirectPath = storedRedirect || ROUTES.workStation.base.path;
          redirectFromSuccessfulCallback(redirectPath);
        }
        return;
      }

      isProcessingRef.current = true;

      try {
        await markCodeAsProcessed(result.code);

        const tokenResponse = await exchangeSupabaseCodeForSession(result.code);

        const store = getDefaultStore();
        store.set(serviceAuthAtom, true);
        store.set(hostedTokenAtom, tokenResponse.access_token);
        store.set(serviceExpiryAtom, tokenResponse.expires_in);
        store.set(serviceValidatedAtom, true);

        window.dispatchEvent(new Event("localStorageChange"));

        await clearProcessedCode();

        const storedRedirect = sessionStorage.getItem("login_redirect");
        sessionStorage.removeItem("login_redirect");
        const redirectPath = storedRedirect || ROUTES.workStation.base.path;
        redirectFromSuccessfulCallback(redirectPath);
      } catch (exchangeError) {
        log.error("Token exchange failed:", exchangeError);
        const errorMessage =
          exchangeError instanceof Error
            ? exchangeError.message
            : t("market.auth.tokenExchangeFailed");
        setError(errorMessage);
        redirectFromFailedCallback();
      }
    };

    handleCallback();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [location.search, navigate, t]);

  return (
    <LoginLoadingState
      error={error}
      stage={isComplete ? "success" : "waiting"}
    />
  );
};

export default AuthCallback;
