import { formatClockRange } from "@src/util/time/formatClockTime";

export function formatTranscriptRoundTimeLabel(round: {
  startedAt?: string;
  endedAt?: string | null;
}): string {
  if (!round.startedAt) return "";
  const startMs = Date.parse(round.startedAt);
  const endMs = round.endedAt ? Date.parse(round.endedAt) : startMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "";
  return formatClockRange(startMs, endMs);
}
