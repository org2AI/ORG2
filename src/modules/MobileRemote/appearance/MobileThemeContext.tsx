import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type GlobalThemePreference,
  type SystemColorScheme,
  THEME_PREFERENCE,
  normalizeGlobalThemePreference,
} from "@src/config/appearance/globalThemes";

import type { MobileRemotePlatform } from "../platform";

// Keep mobile choices separate from Desktop on shared browser origins.
// Do not migrate "theme": that value may belong to Desktop.
const MOBILE_THEME_STORAGE_KEY = "mobileRemote.theme";

export type MobileThemeStatus = "idle" | "applying" | "error";

export interface MobileThemeContextValue {
  preference: GlobalThemePreference;
  systemColorScheme: SystemColorScheme;
  resolvedColorScheme: SystemColorScheme;
  status: MobileThemeStatus;
  setPreference(preference: GlobalThemePreference): Promise<void>;
}

const fallbackThemeContext: MobileThemeContextValue = {
  preference: THEME_PREFERENCE.SYSTEM,
  systemColorScheme: "light",
  resolvedColorScheme: "light",
  status: "idle",
  setPreference: async () => undefined,
};

const MobileThemeContext =
  createContext<MobileThemeContextValue>(fallbackThemeContext);

function readPreference(platform: MobileRemotePlatform): GlobalThemePreference {
  try {
    return normalizeGlobalThemePreference(
      platform.runtime.readPreference?.(MOBILE_THEME_STORAGE_KEY)
    );
  } catch {
    return THEME_PREFERENCE.SYSTEM;
  }
}

export function resolveMobileColorScheme(
  preference: GlobalThemePreference,
  systemColorScheme: SystemColorScheme
): SystemColorScheme {
  return preference === THEME_PREFERENCE.SYSTEM
    ? systemColorScheme
    : preference;
}

export function MobileThemeProvider({
  platform,
  children,
}: {
  platform: MobileRemotePlatform;
  children: React.ReactNode;
}) {
  const appearance = platform.appearance;
  const initialPreference = useMemo(() => readPreference(platform), [platform]);
  const [preference, setPreferenceState] =
    useState<GlobalThemePreference>(initialPreference);
  const [systemColorScheme, setSystemColorScheme] = useState<SystemColorScheme>(
    () => appearance?.getSystemColorScheme() ?? "light"
  );
  const [status, setStatus] = useState<MobileThemeStatus>("idle");
  const preferenceRef = useRef(preference);
  const applyGenerationRef = useRef(0);

  const applyColorScheme = useCallback(
    async (colorScheme: SystemColorScheme) => {
      if (!appearance) return;
      const generation = ++applyGenerationRef.current;
      setStatus("applying");
      try {
        await appearance.applyColorScheme(colorScheme);
        if (applyGenerationRef.current === generation) setStatus("idle");
      } catch {
        if (applyGenerationRef.current === generation) setStatus("error");
      }
    },
    [appearance]
  );

  useEffect(() => {
    if (!appearance) return;
    const generation = ++applyGenerationRef.current;
    const initialColorScheme = resolveMobileColorScheme(
      initialPreference,
      appearance.getSystemColorScheme()
    );
    void Promise.resolve()
      .then(() => {
        if (applyGenerationRef.current === generation) {
          return appearance.applyColorScheme(initialColorScheme);
        }
      })
      .then(
        () => {
          if (applyGenerationRef.current === generation) setStatus("idle");
        },
        () => {
          if (applyGenerationRef.current === generation) setStatus("error");
        }
      );
    return () => {
      applyGenerationRef.current += 1;
    };
  }, [appearance, initialPreference]);

  useEffect(() => {
    if (!appearance) return;

    const reconcileSystemColorScheme = (next?: SystemColorScheme) => {
      const colorScheme = next ?? appearance.getSystemColorScheme();
      setSystemColorScheme(colorScheme);
      if (preferenceRef.current === THEME_PREFERENCE.SYSTEM) {
        applyColorScheme(colorScheme).catch(() => setStatus("error"));
      }
    };

    const unsubscribeSystem = appearance.subscribeSystemColorScheme(
      reconcileSystemColorScheme
    );
    const unsubscribeVisibility = platform.runtime.subscribeVisibility(() => {
      if (!platform.runtime.isHidden()) reconcileSystemColorScheme();
    });
    return () => {
      unsubscribeSystem();
      unsubscribeVisibility();
    };
  }, [appearance, applyColorScheme, platform]);

  const setPreference = useCallback(
    async (nextPreference: GlobalThemePreference) => {
      const normalized = normalizeGlobalThemePreference(nextPreference);
      try {
        platform.runtime.writePreference?.(
          MOBILE_THEME_STORAGE_KEY,
          normalized
        );
      } catch {
        setStatus("error");
        return;
      }

      preferenceRef.current = normalized;
      setPreferenceState(normalized);
      await applyColorScheme(
        resolveMobileColorScheme(
          normalized,
          appearance?.getSystemColorScheme() ?? systemColorScheme
        )
      );
    },
    [appearance, applyColorScheme, platform, systemColorScheme]
  );

  const resolvedColorScheme = resolveMobileColorScheme(
    preference,
    systemColorScheme
  );
  const value = useMemo<MobileThemeContextValue>(
    () => ({
      preference,
      systemColorScheme,
      resolvedColorScheme,
      status,
      setPreference,
    }),
    [preference, resolvedColorScheme, setPreference, status, systemColorScheme]
  );

  return (
    <MobileThemeContext.Provider value={value}>
      {children}
    </MobileThemeContext.Provider>
  );
}

export function useMobileTheme(): MobileThemeContextValue {
  return useContext(MobileThemeContext);
}

MobileThemeProvider.displayName = "MobileThemeProvider";
