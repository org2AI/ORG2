import type {
  LearningCategoryValue,
  LearningStatusValue,
} from "@src/api/tauri/rpc/schemas/learning";

export type StatusFilterKey = "all" | LearningStatusValue;
export type CategoryFilterKey = "all" | LearningCategoryValue;

export const STATUS_FILTER_ALL = "all" as const;
export const LEARNINGS_PAGE_SIZE = 25;

export const STATUS_SELECT_ORDER: StatusFilterKey[] = [
  "all",
  "pending",
  "active",
  "deprecated",
];

export const CATEGORY_SELECT_ORDER: CategoryFilterKey[] = [
  "all",
  "pattern",
  "correction",
  "preference",
  "strategy",
];

export const READ_ONLY_LEARNING_STATUSES: readonly LearningStatusValue[] = [
  "merged",
  "abandoned",
];
