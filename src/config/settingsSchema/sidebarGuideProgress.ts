import { z } from "zod";

export const SIDEBAR_GUIDE_PERSISTED_MILESTONES = [
  "teammate_invited",
  "product_tour_started",
  // Original team-activity milestone now backs the team-usage guide task.
  "team_activity_viewed",
] as const;

export const SidebarGuideProgressSchema = z.object({
  version: z.literal(1),
  dismissed: z.boolean().default(false),
  guideCompletedMilestones: z
    .array(z.enum(SIDEBAR_GUIDE_PERSISTED_MILESTONES))
    .default([]),
});

export type SidebarGuideProgress = z.infer<typeof SidebarGuideProgressSchema>;

export const DEFAULT_SIDEBAR_GUIDE_PROGRESS: SidebarGuideProgress = {
  version: 1,
  dismissed: false,
  guideCompletedMilestones: [],
};
