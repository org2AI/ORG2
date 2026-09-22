import { atom } from "jotai";
import isEqual from "lodash/isEqual";

import { projectApi } from "@src/api/http/project";
import type { MemberEntry } from "@src/api/http/project";
import type { CloudOrgMember } from "@src/features/Org2Cloud/org2CloudClient";
import { createLogger } from "@src/hooks/logger";

import type { TeamInboxIssue } from "./domain";
import type { SessionHandoffProjectRoster } from "./sessionHandoffProjects";

const log = createLogger("TeamInboxDataSource");
const MEMBER_READ_CONCURRENCY = 8;

export interface MemberSnapshot {
  members: MemberEntry[];
  projectRosters: SessionHandoffProjectRoster[];
  issue: TeamInboxIssue | null;
}

export interface RetainedMemberSnapshot {
  members: MemberEntry[];
  issue: TeamInboxIssue | null;
  loadedForRosterVersion: number | null;
}

export interface CloudMemberSnapshot {
  key: string;
  rosterVersion: number | null;
  members: CloudOrgMember[];
}

const EMPTY_MEMBER_SNAPSHOT: MemberSnapshot = {
  members: [],
  projectRosters: [],
  issue: null,
};

const EMPTY_RETAINED_MEMBER_SNAPSHOT: RetainedMemberSnapshot = {
  members: [],
  issue: null,
  loadedForRosterVersion: null,
};

// Per-Jotai-store snapshots survive the rendered Inbox surface unmounting,
// without sharing identity or roster data between app/store instances.
export const teamInboxMemberSnapshotAtom = atom<RetainedMemberSnapshot>(
  EMPTY_RETAINED_MEMBER_SNAPSHOT
);
export const teamInboxCloudMemberSnapshotAtom = atom<CloudMemberSnapshot>({
  key: "",
  rosterVersion: null,
  members: [],
});

export function retainMemberSnapshot(
  current: RetainedMemberSnapshot,
  incoming: MemberSnapshot,
  loadedForRosterVersion: number | null
): RetainedMemberSnapshot {
  const dataUnchanged =
    isEqual(current.members, incoming.members) &&
    isEqual(current.issue, incoming.issue);
  if (dataUnchanged) {
    return current.loadedForRosterVersion === loadedForRosterVersion
      ? current
      : { ...current, loadedForRosterVersion };
  }
  return {
    members: incoming.members,
    issue: incoming.issue,
    loadedForRosterVersion,
  };
}

export function retainCloudMemberSnapshot(
  current: CloudMemberSnapshot,
  incoming: CloudMemberSnapshot
): CloudMemberSnapshot {
  if (
    current.key === incoming.key &&
    isEqual(current.members, incoming.members)
  ) {
    return current.rosterVersion === incoming.rosterVersion
      ? current
      : { ...current, rosterVersion: incoming.rosterVersion };
  }
  return incoming;
}

let membersRequest: Promise<MemberSnapshot> | null = null;

/** The in-flight roster read, if any, so a refresh can wait for it first. */
export function pendingMembersRequest(): Promise<MemberSnapshot> | null {
  return membersRequest;
}

export function resetMembersRequest(): void {
  membersRequest = null;
}

export async function readAllProjectMembers(): Promise<MemberSnapshot> {
  if (membersRequest) return membersRequest;
  membersRequest = (async () => {
    const projects = await projectApi.readProjects();
    if (projects.length === 0) return EMPTY_MEMBER_SNAPSHOT;

    const projectRosters: SessionHandoffProjectRoster[] = [];
    const failures: unknown[] = [];
    let nextIndex = 0;
    const workerCount = Math.min(MEMBER_READ_CONCURRENCY, projects.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < projects.length) {
        const index = nextIndex;
        nextIndex += 1;
        const project = projects[index];
        try {
          const file = await projectApi.readMembers(project.slug);
          projectRosters.push({ project, members: file.members });
        } catch (error) {
          failures.push(error);
        }
      }
    });
    await Promise.all(workers);
    if (projectRosters.length === 0 && failures.length > 0) {
      throw failures[0];
    }
    if (failures.length > 0) {
      log.warn(
        `Skipped ${failures.length} project member file(s) while resolving Team Inbox identity`
      );
    }

    const members = new Map<string, MemberEntry>();
    for (const roster of projectRosters) {
      for (const member of roster.members) {
        const existing = members.get(member.id);
        if (
          !existing ||
          (member.last_commit_date ?? "") > (existing.last_commit_date ?? "")
        ) {
          members.set(member.id, member);
        }
      }
    }
    return {
      members: [...members.values()],
      projectRosters,
      issue:
        failures.length > 0
          ? {
              code: "partial_load",
              detail: `${failures.length} project member file(s) could not be read`,
            }
          : null,
    };
  })();
  try {
    return await membersRequest;
  } finally {
    membersRequest = null;
  }
}

export function issueError(issue: TeamInboxIssue): Error & {
  issue: TeamInboxIssue;
} {
  return Object.assign(new Error(issue.detail ?? `Team Inbox ${issue.code}`), {
    issue,
  });
}

export const __TEAM_INBOX_MEMBER_INTERNALS = {
  resetRequest: resetMembersRequest,
};
