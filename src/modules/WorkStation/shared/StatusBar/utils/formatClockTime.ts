import { resolveTimeZoneForIntl } from "@src/config/timezone";
import { toIntlLocaleTag } from "@src/util/data/formatters/date";

/**
 * Clock time (`HH:MM`) of a status-bar timestamp in the user's language and
 * timezone preference. Returns "" when Intl rejects the locale or zone.
 */
export function formatClockTime(timestamp: number, language: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString(toIntlLocaleTag(language), {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: resolveTimeZoneForIntl(),
    });
  } catch {
    return "";
  }
}
