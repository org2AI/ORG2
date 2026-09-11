/**
 * Date Utilities with Timezone Support
 *
 * This module provides timezone-aware date parsing and formatting functions.
 * The API typically returns UTC timestamps without timezone indicators,
 * so we need to handle them properly based on user preferences.
 *
 * Consolidated from:
 * - dateUtils.ts (original)
 * - formatTimeStamp.ts (merged)
 * - timeCount.ts (merged)
 * - dayjsAdaptArea.ts (merged)
 */
// Direct leaf import to avoid pulling @src/store's barrel — which transitively
// reaches workstation/codeEditor modules and creates a circular dependency.
import {
  getCurrentTimezone,
  resolveTimeZoneForIntl,
} from "@src/config/timezone";
import i18n from "@src/i18n";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

import { parseApiDate } from "./dateCore";

export { parseApiDate };

/**
 * Format a date for display in the user's preferred timezone.
 *
 * @param dateString - The date string from the API (assumed UTC if no timezone)
 * @param options - Intl.DateTimeFormat options
 * @param locale - BCP 47 locale used for the rendered date
 * @returns A formatted date string in the user's timezone
 */
export const formatDate = (
  dateString: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  locale?: string
): string => {
  if (!dateString) return "—";

  try {
    const date = parseApiDate(dateString);
    if (!date) return "—";

    const timezone = getCurrentTimezone();
    const defaultOptions: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    };

    const formatOptions = { ...defaultOptions, ...options };

    // Apply timezone if not "auto"
    if (timezone !== "auto") {
      formatOptions.timeZone = timezone === "utc" ? "UTC" : timezone;
    }

    return date.toLocaleString(resolveDateLocale(locale), formatOptions);
  } catch {
    return "—";
  }
};

/**
 * Format a date to show only the time (HH:MM format)
 *
 * @param dateString - The date string from the API (assumed UTC if no timezone)
 * @returns A formatted time string
 */
export const formatTime = (
  dateString: string | null | undefined,
  locale?: string
): string => {
  if (!dateString) return "—";

  try {
    const date = parseApiDate(dateString);
    if (!date) return "—";

    const timezone = getCurrentTimezone();
    const options: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    };

    if (timezone !== "auto") {
      options.timeZone = timezone === "utc" ? "UTC" : timezone;
    }

    return date.toLocaleTimeString(resolveDateLocale(locale), options);
  } catch {
    return "—";
  }
};

/**
 * Map app language codes to BCP-47 locale tags for {@link Intl} (month names, time).
 */
export function toIntlLocaleTag(language: string | undefined): string {
  const mapped =
    language === "en"
      ? "en-US"
      : language === "zh"
        ? "zh-CN"
        : language === "zh-Hant"
          ? "zh-Hant-TW"
          : language === "ja"
            ? "ja-JP"
            : language === "ko"
              ? "ko-KR"
              : language;
  if (!mapped) return "en-US";

  try {
    const canonical = Intl.getCanonicalLocales(mapped)[0];
    return canonical &&
      Intl.DateTimeFormat.supportedLocalesOf([canonical]).length > 0
      ? canonical
      : "en-US";
  } catch {
    return "en-US";
  }
}

/** Explicit locale wins; otherwise follow the currently resolved app language. */
export function resolveDateLocale(locale?: string): string {
  return toIntlLocaleTag(
    locale ?? i18n.resolvedLanguage ?? i18n.language ?? "en"
  );
}

// `Date#toLocale*` is specified in terms of a fresh Intl formatter. That is
// convenient for one-off calls, but chat timelines format the same timestamp
// shapes many times while their React trees mount and unmount. WebKit keeps
// the ICU backing allocations alive until a later GC, so repeated
// Group/Member navigation can grow the WebContent RSS even though no DOM node
// is leaked. Keep a small LRU of the actual formatters instead: locale,
// timezone, and options remain part of the key, so output semantics do not
// change and the cache stays bounded across language switching.
const DATE_TIME_FORMAT_CACHE_MAX = 64;
const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();

function dateTimeFormatCacheKey(
  locale: Intl.LocalesArgument | undefined,
  options: Intl.DateTimeFormatOptions
): string {
  return JSON.stringify([
    locale,
    Object.entries(options).sort(([left], [right]) =>
      left.localeCompare(right)
    ),
  ]);
}

function cachedDateTimeFormatter(
  locale: Intl.LocalesArgument | undefined,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = dateTimeFormatCacheKey(locale, options);
  const cached = dateTimeFormatCache.get(key);
  if (cached) {
    // Refresh insertion order so the cap behaves as a true LRU when users
    // exercise many locale/timezone combinations in one long-lived app.
    dateTimeFormatCache.delete(key);
    dateTimeFormatCache.set(key, cached);
    return cached;
  }

  const formatter = new Intl.DateTimeFormat(locale, options);
  dateTimeFormatCache.set(key, formatter);
  if (dateTimeFormatCache.size > DATE_TIME_FORMAT_CACHE_MAX) {
    const oldestKey = dateTimeFormatCache.keys().next().value;
    if (oldestKey !== undefined) dateTimeFormatCache.delete(oldestKey);
  }
  return formatter;
}

const SHORT_LOCAL_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
};

const SHORT_LOCAL_TIME_24_HOUR_OPTIONS: Intl.DateTimeFormatOptions = {
  ...SHORT_LOCAL_TIME_OPTIONS,
  hour12: false,
};

/** Format a local HH:MM label without recreating Intl formatters per render. */
export function formatShortLocalTime(date: Date): string {
  return cachedDateTimeFormatter([], SHORT_LOCAL_TIME_OPTIONS).format(date);
}

/** Format a local 24-hour HH:MM label through the shared bounded cache. */
export function formatShortLocalTime24Hour(date: Date): string {
  return cachedDateTimeFormatter(
    undefined,
    SHORT_LOCAL_TIME_24_HOUR_OPTIONS
  ).format(date);
}

function dateKeyInTimezone(date: Date, timeZone: string | undefined): string {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  if (timeZone !== undefined) {
    options.timeZone = timeZone;
  }
  return cachedDateTimeFormatter("en-CA", options).format(date);
}

function ymdAddDays(
  year: number,
  month: number,
  day: number,
  deltaDays: number
): string {
  const dt = new Date(Date.UTC(year, month - 1, day + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = dt.getUTCMonth() + 1;
  const dd = dt.getUTCDate();
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export function getStartOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addLocalDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function addLocalMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

export function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function getLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getLocalDayDiff(date: Date, now: Date = new Date()): number {
  return Math.round(
    (getStartOfLocalDay(now).getTime() - getStartOfLocalDay(date).getTime()) /
      86_400_000
  );
}

export function formatLocalClock(date: Date, locale?: string): string {
  return date.toLocaleString(resolveDateLocale(locale), {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatLocalMonthDay(
  date: Date,
  options?: {
    includeYear?: boolean;
    locale?: string | undefined;
    monthStyle?: "short" | "long";
  }
): string {
  const locale = resolveDateLocale(options?.locale);
  return date.toLocaleDateString(locale, {
    month: options?.monthStyle ?? "short",
    day: "numeric",
    ...(options?.includeYear ? { year: "numeric" as const } : {}),
  });
}

export function formatRelativeElapsedShort(
  date: Date,
  now: Date = new Date(),
  locale?: string
): string {
  return formatRelativeTime(date.getTime(), "elapsed", locale, now.getTime());
}

export interface FormatSmartDateTimeOptions {
  /** Label for the previous calendar day (from i18n). Default: "Yesterday" */
  yesterdayLabel?: string;
  /** Locale for month names and time. Defaults to the resolved app language. */
  locale?: string;
}

/**
 * Format an instant for chat-style display using the user's timezone setting:
 * - Same calendar day as "now": time only (24h)
 * - Previous calendar day: "Yesterday" label + time (pass translated label)
 * - Same calendar year: month + day + time (no year)
 * - Other years: month + day + year + time
 */
export function formatSmartDateTime(
  dateString: string | null | undefined,
  options?: FormatSmartDateTimeOptions
): string {
  if (!dateString) return "—";

  try {
    const date = parseApiDate(dateString);
    if (!date) return "—";

    const timeZone = resolveTimeZoneForIntl();
    const locale = resolveDateLocale(options?.locale);
    const yesterdayLabel =
      options?.yesterdayLabel ??
      String(
        i18n.t("common:relativeDate.yesterday", {
          defaultValue: "Yesterday",
        })
      );

    const now = new Date();
    const todayKey = dateKeyInTimezone(now, timeZone);
    const eventKey = dateKeyInTimezone(date, timeZone);

    const timeOpts: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    };
    if (timeZone !== undefined) {
      timeOpts.timeZone = timeZone;
    }
    const timePart = cachedDateTimeFormatter(locale, timeOpts).format(date);

    if (eventKey === todayKey) {
      return timePart;
    }

    const [todayYear, todayMonth, todayDay] = todayKey.split("-").map(Number);
    const yesterdayKey = ymdAddDays(todayYear, todayMonth, todayDay, -1);

    if (eventKey === yesterdayKey) {
      return `${yesterdayLabel} ${timePart}`;
    }

    const [eventYear] = eventKey.split("-").map(Number);
    const [currentYear] = todayKey.split("-").map(Number);

    const dateTimeOpts: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    };
    if (timeZone !== undefined) {
      dateTimeOpts.timeZone = timeZone;
    }

    if (eventYear === currentYear) {
      return cachedDateTimeFormatter(locale, dateTimeOpts).format(date);
    }

    return cachedDateTimeFormatter(locale, {
      ...dateTimeOpts,
      year: "numeric",
    }).format(date);
  } catch {
    return "—";
  }
}

export interface FormatCalendarDateLabelOptions {
  /** Translated "Today" label (from i18n). Default: "Today" */
  todayLabel?: string;
  /** Translated "Yesterday" label (from i18n). Default: "Yesterday" */
  yesterdayLabel?: string;
  /** BCP-47 locale tag for month names. Defaults to the resolved app language. */
  locale?: string;
  /** Month display style for non-relative dates. Default: `short`. */
  monthStyle?: "short" | "long";
}

export function formatCalendarDateLabel(
  input: string | number | null | undefined,
  options?: FormatCalendarDateLabelOptions
): string {
  if (input == null || input === "") return "";

  try {
    const date =
      typeof input === "number" ? new Date(input) : parseApiDate(input);
    if (!date || Number.isNaN(date.getTime())) return "";

    const timeZone = resolveTimeZoneForIntl();
    const locale = resolveDateLocale(options?.locale);
    const todayLabel =
      options?.todayLabel ??
      String(i18n.t("common:relativeDate.today", { defaultValue: "Today" }));
    const yesterdayLabel =
      options?.yesterdayLabel ??
      String(
        i18n.t("common:relativeDate.yesterday", {
          defaultValue: "Yesterday",
        })
      );
    const monthStyle = options?.monthStyle ?? "short";

    const now = new Date();
    const todayKey = dateKeyInTimezone(now, timeZone);
    const eventKey = dateKeyInTimezone(date, timeZone);

    if (eventKey === todayKey) {
      return todayLabel;
    }

    const [todayYear, todayMonth, todayDay] = todayKey.split("-").map(Number);
    const yesterdayKey = ymdAddDays(todayYear, todayMonth, todayDay, -1);
    if (eventKey === yesterdayKey) {
      return yesterdayLabel;
    }

    const [eventYear] = eventKey.split("-").map(Number);
    const dateOpts: Intl.DateTimeFormatOptions = {
      month: monthStyle,
      day: "numeric",
    };
    if (timeZone !== undefined) {
      dateOpts.timeZone = timeZone;
    }
    if (eventYear !== todayYear) {
      dateOpts.year = "numeric";
    }

    return date.toLocaleDateString(locale, dateOpts);
  } catch {
    return "";
  }
}

export interface FormatReplayDateLabelOptions {
  /** Translated "Today" label (from i18n). Default: "Today" */
  todayLabel?: string;
  /** Translated "Yesterday" label (from i18n). Default: "Yesterday" */
  yesterdayLabel?: string;
  /** BCP-47 locale tag for month names. Defaults to the resolved app language. */
  locale?: string;
  /**
   * Whether to include seconds in the time portion. The kanban replay bar
   * scrubs at second granularity so it wants `HH:mm:ss`; consumers that
   * only need minute granularity can pass `false`. Default: `true`.
   */
  withSeconds?: boolean;
  /** Month display style for non-relative dates. Default: `long`. */
  monthStyle?: "short" | "long";
}

/**
 * Format a replay-cursor instant with a smart date prefix:
 * - Same calendar day as now → `Today HH:mm:ss`
 * - Previous calendar day    → `Yesterday HH:mm:ss`
 * - Same calendar year       → `March 29 HH:mm:ss`
 * - Other years              → `March 29, 2024 HH:mm:ss`
 *
 * Differs from `formatSmartDateTime` in three ways: always shows the
 * "Today" label (even when same-day), uses long month names instead of
 * short, and supports HH:mm:ss granularity. The replay bar scrubs at
 * second resolution so the timestamp needs to update visibly as the
 * cursor moves; minute-level display would feel frozen.
 */
export function formatReplayDateLabel(
  input: string | number | null | undefined,
  options?: FormatReplayDateLabelOptions
): string {
  if (input == null || input === "") return "";

  try {
    const date =
      typeof input === "number" ? new Date(input) : parseApiDate(input);
    if (!date || Number.isNaN(date.getTime())) return "";

    const timeZone = resolveTimeZoneForIntl();
    const locale = resolveDateLocale(options?.locale);
    const todayLabel =
      options?.todayLabel ??
      String(i18n.t("common:relativeDate.today", { defaultValue: "Today" }));
    const yesterdayLabel =
      options?.yesterdayLabel ??
      String(
        i18n.t("common:relativeDate.yesterday", {
          defaultValue: "Yesterday",
        })
      );
    const withSeconds = options?.withSeconds ?? true;
    const monthStyle = options?.monthStyle ?? "long";

    const now = new Date();
    const todayKey = dateKeyInTimezone(now, timeZone);
    const eventKey = dateKeyInTimezone(date, timeZone);

    const timeOpts: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    };
    if (withSeconds) {
      timeOpts.second = "2-digit";
    }
    if (timeZone !== undefined) {
      timeOpts.timeZone = timeZone;
    }
    const timePart = date.toLocaleTimeString(locale, timeOpts);

    if (eventKey === todayKey) {
      return `${todayLabel} ${timePart}`;
    }

    const [todayYear, todayMonth, todayDay] = todayKey.split("-").map(Number);
    const yesterdayKey = ymdAddDays(todayYear, todayMonth, todayDay, -1);
    if (eventKey === yesterdayKey) {
      return `${yesterdayLabel} ${timePart}`;
    }

    const [eventYear] = eventKey.split("-").map(Number);

    const dateOpts: Intl.DateTimeFormatOptions = {
      month: monthStyle,
      day: "numeric",
    };
    if (timeZone !== undefined) {
      dateOpts.timeZone = timeZone;
    }
    if (eventYear !== todayYear) {
      dateOpts.year = "numeric";
    }
    const datePart = date.toLocaleDateString(locale, dateOpts);

    return `${datePart} ${timePart}`;
  } catch {
    return "";
  }
}

// ============================================
// Legacy formatters (browser-local, no timezone setting)
// ============================================

/**
 * Format a Unix timestamp as a readable date/time string
 * @param timestamp - Unix timestamp in seconds
 * @returns Formatted string like "Jan 05, 2025, 14:30"
 */
export const formatDateTime = (timestamp: number, locale?: string): string => {
  const date = new Date(timestamp * 1000);
  return new Intl.DateTimeFormat(resolveDateLocale(locale), {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};
