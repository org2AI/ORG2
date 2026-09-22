import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";

export type {
  AdeManagerActivityItem,
  AdeManagerActivityStatus,
  AdeManagerRunStatus,
} from "@src/contracts/session/ade";

export interface AdeManagerSubmitDetail {
  text: string;
  modelSelection: LastModelSelection | null;
}
