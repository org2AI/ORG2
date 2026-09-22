import type { Store } from "jotai/vanilla/store";

import { invalidateProjectCache, projectApi } from "@src/api/http/project";
import type { Org2CloudAuthState } from "@src/features/Org2Cloud/org2CloudAuthState";
import { loadCloudOrgMembers } from "@src/features/Org2Cloud/org2CloudMembersCoordinator";
import type { Org2CloudOrg } from "@src/features/Org2Cloud/org2CloudOrgsAtom";
import { sessionByIdAtom } from "@src/store/session";

import { createWorkItemFromSession } from "./createWorkItemFromSession";
import { sessionHandoffDraft } from "./createWorkItemFromSession";
import type {
  TeamInboxDataSource,
  TeamInboxHandoffDestination,
  TeamInboxSessionHandoffDraft,
} from "./domain";
import { SessionHandoffPreparationError } from "./sessionHandoffError";
import {
  eligibleSessionHandoffProjects,
  handoffCloudOrgFromRoster,
  handoffProjectFromRoster,
} from "./sessionHandoffProjects";
import { observeSharedOperation } from "./sharedOperation";
import { teamInboxCoordinator } from "./teamInboxCoordinator";
import type { TeamInboxCoordinatorScope } from "./teamInboxCoordinator";
import { readAllProjectMembers } from "./teamInboxMemberSnapshot";

const sessionCreationFlights = new Map<
  string,
  ReturnType<typeof createWorkItemFromSession>
>();
const sessionPreparationFlights = new Map<
  string,
  Promise<TeamInboxSessionHandoffDraft>
>();

export interface TeamInboxSessionHandoffContext {
  store: Store;
  scope: TeamInboxCoordinatorScope;
  auth: Org2CloudAuthState | null;
  activeCloudOrg: Org2CloudOrg | null;
  activeCloudRosterVersion: number;
  viewerMemberIds: readonly string[];
}

async function prepareSessionHandoff(
  {
    store,
    auth,
    activeCloudOrg,
    activeCloudRosterVersion,
    viewerMemberIds,
  }: TeamInboxSessionHandoffContext,
  {
    sessionId,
    title,
    signal,
  }: {
    sessionId: string;
    title: string;
    signal?: AbortSignal;
  }
): Promise<TeamInboxSessionHandoffDraft> {
  const session = store.get(sessionByIdAtom(sessionId));
  if (!session) {
    throw new SessionHandoffPreparationError("session_unavailable");
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  let sourceDestinationKey: string | undefined;
  const destinations: TeamInboxHandoffDestination[] = [];

  if (auth && activeCloudOrg) {
    const loaded = await loadCloudOrgMembers(
      store,
      auth,
      activeCloudOrg.orgId,
      activeCloudRosterVersion
    );
    const cloudDestination = loaded
      ? handoffCloudOrgFromRoster(activeCloudOrg, loaded.members, auth.userId)
      : null;
    if (!cloudDestination) {
      throw new SessionHandoffPreparationError("identity_unavailable");
    }
    destinations.push(cloudDestination);
    sourceDestinationKey = cloudDestination.key;
  }

  if (destinations.length === 0 && (session.projectSlug || session.projectId)) {
    const project = await (session.projectSlug
      ? projectApi.readProject(session.projectSlug)
      : projectApi
          .readProjects()
          .then(
            (entries) =>
              entries.find((entry) => entry.meta.id === session.projectId) ??
              null
          ));
    if (!project && destinations.length === 0) {
      throw new SessionHandoffPreparationError("project_unavailable");
    }
    if (project) {
      const entries = (await projectApi.readMembers(project.slug)).members;
      const candidate = handoffProjectFromRoster(
        project,
        entries,
        viewerMemberIds
      );
      if (candidate) {
        destinations.push(candidate);
        sourceDestinationKey ??= candidate.key;
      }
    }
  } else if (destinations.length === 0) {
    // A standalone Session has no canonical project boundary. Resolve a
    // fresh roster for both preview and submit so a removed membership or
    // newly joined project cannot be accepted from a stale hook snapshot.
    const latestMemberSnapshot = await readAllProjectMembers();
    destinations.push(
      ...eligibleSessionHandoffProjects(
        latestMemberSnapshot.projectRosters,
        viewerMemberIds
      )
    );
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  if (destinations.length === 0) {
    throw new SessionHandoffPreparationError(
      session.projectSlug || session.projectId
        ? "identity_unavailable"
        : "no_project"
    );
  }
  return sessionHandoffDraft(
    session,
    destinations,
    title,
    sourceDestinationKey
  );
}

/**
 * Session-drop members of the Team Inbox data source. Both are shared-flight
 * operations keyed by the scope and the exact drop input.
 */
export function createTeamInboxSessionHandoffMethods(
  context: TeamInboxSessionHandoffContext
): Pick<
  TeamInboxDataSource,
  "prepareSessionHandoff" | "createWorkItemFromSession"
> {
  const { store, scope, viewerMemberIds } = context;
  return {
    prepareSessionHandoff: viewerMemberIds[0]
      ? ({ sessionId, title, signal }) => {
          const flightKey = `${scope.key}:${sessionId}:${title.trim()}`;
          const existing = sessionPreparationFlights.get(flightKey);
          if (existing) return observeSharedOperation(existing, signal);
          const flight = prepareSessionHandoff(context, {
            sessionId,
            title,
          }).finally(() => {
            if (sessionPreparationFlights.get(flightKey) === flight) {
              sessionPreparationFlights.delete(flightKey);
            }
          });
          sessionPreparationFlights.set(flightKey, flight);
          return observeSharedOperation(flight, signal);
        }
      : undefined,
    createWorkItemFromSession: viewerMemberIds[0]
      ? ({
          sessionId,
          title,
          destinationKey,
          assigneeMemberId,
          status,
          priority,
          targetDate,
          handoffNote,
          signal,
        }) => {
          const flightKey = [
            scope.key,
            sessionId,
            destinationKey,
            assigneeMemberId,
            status,
            priority,
            targetDate ?? "",
            title.trim(),
            handoffNote?.trim() ?? "",
          ].join(":");
          const existing = sessionCreationFlights.get(flightKey);
          if (existing) return observeSharedOperation(existing, signal);

          const session = store.get(sessionByIdAtom(sessionId));
          if (!session) {
            return Promise.reject(
              new Error("The dropped Session is no longer available")
            );
          }

          const flight = prepareSessionHandoff(context, {
            sessionId,
            title,
          })
            .then((draft) => {
              const destination = draft.destinations.find(
                (candidate) => candidate.key === destinationKey
              );
              if (!destination) {
                throw new Error(
                  "The selected destination is no longer available"
                );
              }
              const recipient = destination.recipients.find(
                (member) => member.id === assigneeMemberId
              );
              if (!recipient) {
                throw new Error(
                  "The selected recipient is no longer available"
                );
              }
              return createWorkItemFromSession({
                session,
                title,
                destination:
                  destination.kind === "cloud_org"
                    ? {
                        kind: "cloud_org",
                        orgId: destination.orgId,
                      }
                    : {
                        kind: "project",
                        projectSlug: destination.projectSlug,
                      },
                assigneeMemberId: recipient.id,
                assigneeMemberName: recipient.name,
                senderMemberId: destination.sender.id,
                senderMemberName: destination.sender.name,
                recipientIsCurrentUser: recipient.isCurrentUser,
                status,
                priority,
                targetDate,
                handoffNote,
              });
            })
            .then((result) => {
              invalidateProjectCache();
              teamInboxCoordinator.invalidate(store);
              return result;
            })
            .finally(() => {
              if (sessionCreationFlights.get(flightKey) === flight) {
                sessionCreationFlights.delete(flightKey);
              }
            });
          sessionCreationFlights.set(flightKey, flight);
          return observeSharedOperation(flight, signal);
        }
      : undefined,
  };
}
