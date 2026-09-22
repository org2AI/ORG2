/**
 * Org2CloudSyncEngine — per-org session push loop of one sync pass.
 *
 * For one visited org: cold-start summary hydration, then every own local
 * session runs the admission decision, repo-scope match, access ladder and
 * push/retract/park outcome, followed by the vanished-session GC for that
 * org. Every rail is documented inline; the module header of
 * `org2CloudSyncEngine.ts` gives the design overview (§13.4 ladder, repo
 * scopes as the hard boundary, fork provenance, retention parking).
 *
 * Control flow mirrors the original in-class loop: `continue` moves to the
 * next session, `break` stops touching this org for the rest of the run
 * (falls through to the GC), and an aborted pass is reported to the caller
 * as `true` so the enclosing org loop can bail the whole pass.
 */
import { createLogger } from "@src/hooks/logger";
import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";

import { getSessionForkedFrom } from "../TeamCollaboration/forkSession";
import { peekMatchingOrgRepoScope } from "../TeamCollaboration/repoScopeResolver";
import {
  isSessionTaggedToCloudOrg,
  sessionOrgTagsAtom,
  withoutCloudOrgTag,
} from "../TeamCollaboration/sessionOrgTagsAtom";
import { getCloudEndpoint } from "./config";
import {
  type CloudAccessSettingsByOrg,
  type CloudSharingFloorByOrg,
  hasExplicitCloudShareIntent,
  resolveCloudPushAccess,
} from "./org2CloudAccessSettings";
import {
  type Org2CloudAuthState,
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import type { Org2CloudOrg } from "./org2CloudOrgsAtom";
import { buildCloudOrgSelectorValue } from "./org2CloudOrgsAtom";
import {
  PUSH_ADMISSION_DENIAL,
  decidePushAdmission,
} from "./org2CloudPushAdmission";
import type { Org2CloudSessionSync } from "./org2CloudSessionSync";
import { isCloudPushCandidate } from "./org2CloudSessionSync";
import * as org2CloudSyncClient from "./org2CloudSyncClient";
import {
  type Org2CloudOrgBackoffTracker,
  isCloudSyncBackoffError,
} from "./org2CloudSyncEngine.orgBackoff";
import {
  type Org2CloudRepoScopeSync,
  getSessionScopeKeys,
} from "./org2CloudSyncEngine.repoScopeSync";
import {
  isRetentionParked,
  parkRetentionExpired,
} from "./org2CloudSyncEngine.retentionPark";
import type { Org2CloudSessionColdStart } from "./org2CloudSyncEngine.sessionColdStart";
import type { Org2CloudVanishedSweep } from "./org2CloudSyncEngine.vanishedSweep";
import { recordSyncEvent } from "./org2CloudSyncJournal";
import type { CloudStore } from "./org2CloudSyncLifecycle";

const log = createLogger("Org2CloudSyncEngine");

export interface OrgSessionPushDeps {
  store: CloudStore;
  sessionSync: Org2CloudSessionSync;
  orgBackoff: Org2CloudOrgBackoffTracker;
  repoScopeSync: Org2CloudRepoScopeSync;
  sessionColdStart: Org2CloudSessionColdStart;
  vanishedSweep: Org2CloudVanishedSweep;
  isCurrentGeneration: (generation: number) => boolean;
}

export interface OrgSessionPushContext {
  /** Auth state captured at pass start (identity anchor for parking). */
  auth: Org2CloudAuthState;
  /** Refreshed auth every RPC in this pass uses. */
  fresh: Org2CloudAuthState;
  org: Org2CloudOrg;
  /** The org's repo scopes from `org2CloudRepoScopesAtom` (`[]` when unset). */
  scopes: string[];
  accessByOrg: CloudAccessSettingsByOrg;
  floorByOrg: CloudSharingFloorByOrg;
  generation: number;
  /** Endpoint identity captured at pass start; see the engine's pass loop. */
  passSupabaseUrl: string;
}

/**
 * Push every eligible own session to one org, then run that org's
 * vanished-session GC.
 *
 * @returns `true` when the whole pass must abort (generation superseded or
 * the active endpoint diverged from the pass's backend).
 */
export async function pushOrgSessions(
  deps: OrgSessionPushDeps,
  ctx: OrgSessionPushContext
): Promise<boolean> {
  const {
    store,
    sessionSync,
    orgBackoff,
    repoScopeSync,
    sessionColdStart,
    vanishedSweep,
    isCurrentGeneration,
  } = deps;
  const {
    auth,
    fresh,
    org,
    scopes,
    accessByOrg,
    floorByOrg,
    generation,
    passSupabaseUrl,
  } = ctx;
  const remoteSummaries =
    await sessionColdStart.loadSessionSummariesForColdStart(
      fresh,
      org.orgId,
      generation,
      isCurrentGeneration
    );
  if (remoteSummaries === null) return false;
  if (remoteSummaries instanceof Map) {
    vanishedSweep.recordSelfOwnedRemoteIds(org.orgId, remoteSummaries.keys());
  }
  for (const session of store.get(sessionsAtom)) {
    if (!isCurrentGeneration(generation)) return true;
    if (!isCloudPushCandidate(session)) continue;
    if (isRetentionParked(store, org.orgId, session)) {
      continue;
    }
    // A fork is a continuation inside the source collaboration boundary,
    // not a new ordinary repo session. Repo scopes may overlap across a
    // team org and the forker's personal org, so scope matching alone
    // would leak the fork into every matching org. Durable fork
    // provenance is the authority for the implicit destination: an
    // untagged fork publishes only back to its source org. An explicit
    // user tag to this org overrides provenance for this org only; repo
    // scope and membership are still enforced below and server-side.
    // Also retract a wrong-org row produced by an older client whenever
    // this engine has a persisted/current-run push marker for it.
    const forkedFrom = getSessionForkedFrom(session);
    // Re-read LIVE tags before applying provenance. A guest fork may be
    // explicitly moved into one of this user's orgs, and an untag can land
    // while this pass awaits an earlier push.
    const tagged = isSessionTaggedToCloudOrg(
      store.get(sessionOrgTagsAtom),
      session.session_id,
      org.orgId
    );
    const admission = decidePushAdmission({
      orgId: org.orgId,
      session,
      forkedFrom,
      tagged,
      ownedByOrg: session.orgId === buildCloudOrgSelectorValue(org.orgId),
      shareIntent: hasExplicitCloudShareIntent(
        accessByOrg[org.orgId],
        session.session_id
      ),
    });
    if (
      !admission.admitted &&
      admission.denial === PUSH_ADMISSION_DENIAL.FORK_OUTSIDE_SOURCE_ORG
    ) {
      if (sessionSync.wasCloudPushed(org.orgId, session.session_id)) {
        try {
          log.info(
            `cloud retract [${admission.denial}]: session ${session.session_id} org ${org.orgId}`
          );
          await sessionSync.retractSession(
            fresh,
            org.orgId,
            session.session_id
          );
        } catch (error) {
          if (!isCurrentGeneration(generation)) return true;
          if (isCloudSyncBackoffError(error)) {
            orgBackoff.backOffOrg(org.orgId, error);
            break;
          }
          log.warn(
            `cloud retract failed for fork outside source org ${session.session_id}:`,
            error
          );
        }
      }
      continue;
    }
    // Re-read the LIVE tags atom per session rather than the pass-start
    // `tags` snapshot: an untag from MoveToOrgDialog can land while this
    // pass awaits an earlier session's push. The untag already
    // soft-tombstoned the server row (deleteSession); pushing off a stale
    // snapshot would upsert metadata and clear `deleted_at`, resurrecting
    // a tag-only row that no later pass (now untagged and unscoped) ever
    // deletes again. (The pass-start snapshot still drives the coarse
    // org-target selection above, which self-heals on the next pass.)
    // Repo scope is a governance boundary, never an org-membership
    // selector. An ordinary session publishes only to the cloud org it was
    // explicitly created under, or to an org explicitly chosen via Move.
    // This prevents a Personal session from leaking into every team org
    // that happens to configure the same Git remote. Fork provenance has
    // already constrained untagged forks to their source org above.
    if (!admission.admitted) {
      if (sessionSync.wasCloudPushed(org.orgId, session.session_id)) {
        try {
          log.info(
            `cloud retract [${admission.denial}]: session ${session.session_id} org ${org.orgId}`
          );
          await sessionSync.retractSession(
            fresh,
            org.orgId,
            session.session_id
          );
        } catch (error) {
          if (!isCurrentGeneration(generation)) return true;
          if (isCloudSyncBackoffError(error)) {
            orgBackoff.backOffOrg(org.orgId, error);
            break;
          }
          log.warn(
            `cloud retract failed outside explicit org ownership ${session.session_id}:`,
            error
          );
        }
      }
      continue;
    }
    const scopeKeys = getSessionScopeKeys(session);
    // undefined = git-remote resolution still in flight; the next
    // event-driven pass picks the session up once the keys land.
    if (scopeKeys === undefined) continue;
    // Repo scope is the HARD boundary — a tag never bypasses it (the
    // server rejects out-of-scope upserts with ORG2_SCOPE_FORBIDDEN
    // anyway). Multi-remote aware: ANY of the checkout's remotes
    // (origin fork, team upstream, …) may hit an org scope; the matched
    // ORG-side scope string is what gets pushed as repoScopeKey, so the
    // server's exact-string check agrees. Forks are NOT special-cased:
    // a fork syncs back only once it sits in a local checkout of the
    // repo (the fork flow requires picking one), so its own remotes
    // carry the match. A tag that has fallen out of scope (admin
    // removed the scope, or it never matched) is INVALIDATED here:
    // retract the server row if we ever pushed it, then drop the tag so
    // the org falls out of the target set. scopeKeys null (no git
    // remote) is out of scope by definition.
    const matchedScope = peekMatchingOrgRepoScope(scopeKeys, scopes);
    if (matchedScope === undefined) {
      // A pending or failed network-identity lookup cannot prove
      // out-of-scope. Skip until the resolver's completion event runs one
      // coalesced follow-up pass. Expected steady-state on every poll
      // while resolution is in flight — trace-level, not console noise.
      log.trace(
        `scope check deferred for session ${session.session_id} org ` +
          `${org.orgId}: network identity unresolved this pass`
      );
      continue;
    }
    if (matchedScope === null) {
      // The scope mirror is persisted and restored empty-or-stale on
      // boot. An unconfirmed mirror cannot prove "out of scope": acting
      // on it retracts live shared rows and strips their org tags during
      // the first passes after launch. Skip the session until this run
      // has read the org's scopes from the server.
      if (!repoScopeSync.hasServerConfirmedScopes(org.orgId)) {
        // Same expected steady-state as the network-identity wait above:
        // fires on every poll until the org's scopes land — trace-level.
        log.trace(
          `scope check deferred for session ${session.session_id} org ` +
            `${org.orgId}: repo scopes not yet confirmed this run`
        );
        continue;
      }
      if (sessionSync.wasCloudPushed(org.orgId, session.session_id)) {
        try {
          log.info(
            `cloud retract [out-of-scope (no matching org scope)]: session ${session.session_id} org ${org.orgId}`
          );
          await sessionSync.retractSession(
            fresh,
            org.orgId,
            session.session_id
          );
        } catch (error) {
          if (!isCurrentGeneration(generation)) return true;
          if (isCloudSyncBackoffError(error)) {
            orgBackoff.backOffOrg(org.orgId, error);
            break;
          }
          log.warn(
            `cloud retract failed for out-of-scope session ${session.session_id}:`,
            error
          );
          // Keep the tag: retry the retract next pass rather than
          // orphan a live server row.
          continue;
        }
      }
      if (tagged) {
        store.set(sessionOrgTagsAtom, (current) =>
          withoutCloudOrgTag(current, session.session_id, org.orgId)
        );
        log.info(
          `dropped out-of-scope org tag: session ${session.session_id} → org ${org.orgId}`
        );
      }
      continue;
    }
    // BEHAVIOR CHANGE (intended, §13.4): scope matching only made this
    // session a CANDIDATE — adding a repo scope no longer auto-uploads
    // at full replay. The access ladder gates the actual upload: the
    // local mode is OFF until overridden or raised by the org minimum, and
    // an effective-off session is skipped (never uploaded). A TAGGED
    // session still pushes, floored to metadata_only when its effective
    // mode is off ('off' must never reach the server — ORG2_VALIDATION).
    // The admin sharing floor lifts every ADMITTED session. Imported CLI
    // history is admitted by repo-scope matching above: the sidebar groups
    // it into that org automatically, so showing the effective floor in
    // Settings while withholding the matching cloud push would make the
    // rendered policy lie. Ordinary Personal sessions still require org
    // ownership, a tag, fork provenance, or explicit share intent.
    // Reaching here means admission passed, and every admission route
    // (provenance, tag, ownership, intent, scope match) is floor-eligible
    // — so the floor always applies at this point.
    const access = resolveCloudPushAccess(
      accessByOrg[org.orgId],
      session.session_id,
      tagged,
      floorByOrg[org.orgId]
    );
    if (!access) {
      // Effective-off and NOT tagged: the ladder grants nothing this
      // pass. But if we ALREADY published this session (a full_replay
      // past leaves a persisted segments cursor; any rung leaves a
      // metadata hash this run), 'Off' must actively RETRACT it, not just
      // skip — a bare skip leaves the last-pushed access_mode + segments
      // live, so a full_replay→off downgrade keeps teammates on full
      // replay (strictly LESS private than picking 'Metadata only', which
      // re-pushes the lowered column). Soft-tombstone it the same way an
      // untag does. §13.4.
      if (sessionSync.wasCloudPushed(org.orgId, session.session_id)) {
        try {
          log.info(
            `cloud retract [effective-off ladder]: session ${session.session_id} org ${org.orgId}`
          );
          await sessionSync.retractSession(
            fresh,
            org.orgId,
            session.session_id
          );
        } catch (error) {
          if (!isCurrentGeneration(generation)) return true;
          if (isCloudSyncBackoffError(error)) {
            orgBackoff.backOffOrg(org.orgId, error);
            break; // Stop touching this org for the rest of the run.
          }
          log.warn(
            `cloud retract failed for session ${session.session_id}:`,
            error
          );
        }
      }
      continue;
    }
    const remoteSummary = remoteSummaries?.get(session.session_id);
    if (remoteSummary) {
      await sessionSync.seedFromRemoteSummary(
        fresh,
        org.orgId,
        session,
        matchedScope,
        access,
        remoteSummary
      );
      if (!isCurrentGeneration(generation)) return true;
    }
    try {
      await sessionSync.pushSession(
        fresh,
        org.orgId,
        session,
        matchedScope,
        access
      );
    } catch (error) {
      if (!isCurrentGeneration(generation)) return true;
      if (isCloudSyncBackoffError(error)) {
        orgBackoff.backOffOrg(org.orgId, error);
        break; // Stop touching this org for the rest of the run.
      }
      if (
        org2CloudSyncClient.isOrg2SyncErrorCode(error, "ORG2_RETENTION_EXPIRED")
      ) {
        const currentAuth = store.get(org2CloudAuthAtom);
        if (
          !currentAuth ||
          org2CloudAuthIdentityKey(currentAuth) !==
            org2CloudAuthIdentityKey(auth) ||
          getCloudEndpoint().supabaseUrl !== passSupabaseUrl
        )
          return true;
        parkRetentionExpired(store, auth, org.orgId, session);
        recordSyncEvent({
          level: "warn",
          kind: "session_retention_parked",
          orgId: org.orgId,
          message: `Push parked for session ${session.session_id}: past the org's retention window`,
          code: "ORG2_RETENTION_EXPIRED",
        });
        log.warn(
          `cloud push parked for retention-expired session ${session.session_id}`
        );
        continue;
      }
      log.warn(`cloud push failed for session ${session.session_id}:`, error);
    }
  }
  // GC, after the per-session loop: every retract path above only runs
  // for sessions VISITED in sessionsAtom, so a session that left the
  // roster (deleted locally, or an imported continuation sibling the
  // backend election demoted) keeps its server row and push markers
  // forever — teammates see a ghost. Confirmed-vanished marked ids are
  // retracted here with the same backoff handling as the other paths.
  if (getCloudEndpoint().supabaseUrl !== passSupabaseUrl) return true;
  await vanishedSweep.retractVanishedSessions(
    fresh,
    org.orgId,
    generation,
    isCurrentGeneration
  );
  if (!isCurrentGeneration(generation)) return true;
  return false;
}
