import { z } from "zod/v4";

export const WeeklyQuotaHistorySchema = z.array(
  z.object({
    keyId: z.string(),
    provider: z.string(),
    name: z.string(),
    samplingEnabled: z.boolean(),
    status: z.enum(["pending", "ok", "unsupported", "unavailable"]),
    points: z.array(
      z.object({
        capturedAt: z.number(),
        remainingPercent: z.number().min(0).max(100),
        resetAt: z.string().nullable(),
      })
    ),
  })
);
export type WeeklyQuotaHistory = z.infer<typeof WeeklyQuotaHistorySchema>;
