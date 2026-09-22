/**
 * Managed-cloud org-management client (migration 0010 parity with the
 * self-hosted `useMemberActions` surface).
 *
 * Typed wrappers for the org-management `org2_cloud` RPCs: create/join org,
 * invite create/list/revoke, member role change/removal, leave, rename,
 * ownership transfer, org deletion. Same raw-fetch idiom as
 * `org2CloudSyncClient` (JWT Bearer + `Content-Profile: org2_cloud`, no
 * supabase-js) and, like it, these wrappers THROW on failure — the panel
 * needs the server's §22 codes (ORG2_LAST_ADMIN, ORG2_OWNER_MUST_TRANSFER,
 * ORG2_OWNER_REQUIRED, ORG2_QUOTA_EXCEEDED, ORG2_FORBIDDEN,
 * ORG2_MEMBER_NOT_FOUND, ORG2_INVITE_*) to render specific inline messages.
 *
 * Invite plaintext NEVER goes on the wire: `createCloudInvite` mints the
 * code locally, sends only its sha256, and returns the plaintext + deep
 * link for the one-time copy window (see org2CloudOrgManagement header).
 */
import { z } from "zod/v4";

import {
  CLOUD_ASSIGNABLE_ROLES,
  type CloudAssignableRole,
  type CloudInviteRecord,
  type Org2ManagementErrorCode,
  buildCloudInviteLink,
  extractOrg2ManagementErrorCode,
  generateCloudInviteCode,
  sha256Hex,
} from "./org2CloudOrgManagement";
import { callOrg2CloudRpc } from "./org2CloudRpc";

// ---------------------------------------------------------------------------
// Error model
// ---------------------------------------------------------------------------

/** RPC failure carrying the server's §22 code when recognizable. */
export class Org2CloudManagementError extends Error {
  readonly code: Org2ManagementErrorCode | null;
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "Org2CloudManagementError";
    this.status = status;
    this.code = extractOrg2ManagementErrorCode(message);
  }
}

export function isOrg2ManagementErrorCode(
  error: unknown,
  code: Org2ManagementErrorCode
): boolean {
  return error instanceof Org2CloudManagementError && error.code === code;
}

// ---------------------------------------------------------------------------
// RPC plumbing (throwing variant, same shape as org2CloudSyncClient)
// ---------------------------------------------------------------------------

async function callManagementRpc(
  functionName: string,
  accessToken: string,
  body: Record<string, unknown>
): Promise<unknown> {
  return callOrg2CloudRpc(functionName, body, {
    accessToken,
    createError: (message, status) =>
      new Org2CloudManagementError(message, status),
  });
}

// ---------------------------------------------------------------------------
// Wire schemas
// ---------------------------------------------------------------------------

const CreateOrgResponseSchema = z.object({
  orgId: z.string(),
  name: z.string().optional(),
});

const CreateInviteResponseSchema = z.object({
  inviteId: z.string(),
});

const AcceptInviteResponseSchema = z.object({
  orgId: z.string(),
  role: z.enum(CLOUD_ASSIGNABLE_ROLES),
});

const CloudInviteWireSchema = z.object({
  inviteId: z.string(),
  role: z.enum(CLOUD_ASSIGNABLE_ROLES),
  maxUses: z.number(),
  usedCount: z.number(),
  expiresAt: z.string().nullish(),
  createdAt: z.string(),
  revokedAt: z.string().nullish(),
});

const ListInvitesResponseSchema = z.object({
  invites: z.array(CloudInviteWireSchema).default([]),
});

const RenameOrgResponseSchema = z.object({
  ok: z.boolean().optional(),
  name: z.string(),
});

// ---------------------------------------------------------------------------
// Org lifecycle
// ---------------------------------------------------------------------------

/** `create_org` — caller becomes owner; server also mints the membership. */
export async function createCloudOrg(
  accessToken: string,
  name: string
): Promise<{ orgId: string }> {
  const payload = await callManagementRpc("create_org", accessToken, {
    org_name: name,
  });
  const parsed = CreateOrgResponseSchema.parse(payload);
  return { orgId: parsed.orgId };
}

/** `cloud_rename_org` (admin/owner) — returns the server-trimmed name. */
export async function renameCloudOrg(
  accessToken: string,
  orgId: string,
  name: string
): Promise<string> {
  const payload = await callManagementRpc("cloud_rename_org", accessToken, {
    p_org_id: orgId,
    p_name: name,
  });
  return RenameOrgResponseSchema.parse(payload).name;
}

/** `cloud_transfer_ownership` (OWNER-only; new owner must be active). */
export async function transferCloudOwnership(
  accessToken: string,
  orgId: string,
  newOwnerUserId: string
): Promise<void> {
  await callManagementRpc("cloud_transfer_ownership", accessToken, {
    p_org_id: orgId,
    p_new_owner_user_id: newOwnerUserId,
  });
}

/** `cloud_delete_org` (OWNER-only soft delete — org vanishes everywhere). */
export async function deleteCloudOrg(
  accessToken: string,
  orgId: string
): Promise<void> {
  await callManagementRpc("cloud_delete_org", accessToken, {
    p_org_id: orgId,
  });
}

/** `cloud_leave_org` — self-removal; owner gets ORG2_OWNER_MUST_TRANSFER. */
export async function leaveCloudOrg(
  accessToken: string,
  orgId: string
): Promise<void> {
  await callManagementRpc("cloud_leave_org", accessToken, {
    p_org_id: orgId,
  });
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export interface CreateCloudInviteInput {
  orgId: string;
  role: CloudAssignableRole;
  maxUses: number;
  /** ISO timestamp; omitted = the invite never expires. */
  expiresAt?: string;
}

export interface CreatedCloudInvite {
  inviteId: string;
  /** Plaintext code — exists ONLY on this device, show it once. */
  inviteCode: string;
  /** HTTPS handoff link built from the plaintext for safe social sharing. */
  inviteLink: string;
}

/** `create_invite` (admin-only): mint code locally, ship only the hash. */
export async function createCloudInvite(
  accessToken: string,
  input: CreateCloudInviteInput
): Promise<CreatedCloudInvite> {
  const inviteCode = generateCloudInviteCode();
  const payload = await callManagementRpc("create_invite", accessToken, {
    p_org_id: input.orgId,
    invite_code_hash: await sha256Hex(inviteCode),
    invite_role: input.role,
    max_uses: input.maxUses,
    expires_at: input.expiresAt ?? null,
  });
  const parsed = CreateInviteResponseSchema.parse(payload);
  return {
    inviteId: parsed.inviteId,
    inviteCode,
    inviteLink: buildCloudInviteLink(inviteCode),
  };
}

/** `accept_invite`: hash the pasted/linked code, join, return {orgId,role}. */
export async function acceptCloudInvite(
  accessToken: string,
  inviteCode: string
): Promise<{ orgId: string; role: CloudAssignableRole }> {
  const payload = await callManagementRpc("accept_invite", accessToken, {
    invite_code_hash: await sha256Hex(inviteCode),
  });
  return AcceptInviteResponseSchema.parse(payload);
}

/**
 * `cloud_list_invites` (admin-only): full inventory including revoked /
 * exhausted rows so the UI can render their state. Never contains codes.
 */
export async function listCloudInvites(
  accessToken: string,
  orgId: string
): Promise<CloudInviteRecord[]> {
  const payload = await callManagementRpc("cloud_list_invites", accessToken, {
    p_org_id: orgId,
  });
  return ListInvitesResponseSchema.parse(payload).invites.map((invite) => ({
    inviteId: invite.inviteId,
    role: invite.role,
    maxUses: invite.maxUses,
    usedCount: invite.usedCount,
    expiresAt: invite.expiresAt ?? undefined,
    createdAt: invite.createdAt,
    revokedAt: invite.revokedAt ?? undefined,
  }));
}

/** `cloud_revoke_invite` (admin-only, idempotent kill switch). */
export async function revokeCloudInvite(
  accessToken: string,
  orgId: string,
  inviteId: string
): Promise<void> {
  await callManagementRpc("cloud_revoke_invite", accessToken, {
    p_org_id: orgId,
    p_invite_id: inviteId,
  });
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

/** `cloud_update_member_role` — only admin/member are assignable (never owner). */
export async function updateCloudMemberRole(
  accessToken: string,
  orgId: string,
  userId: string,
  role: CloudAssignableRole
): Promise<void> {
  await callManagementRpc("cloud_update_member_role", accessToken, {
    p_org_id: orgId,
    p_user_id: userId,
    p_role: role,
  });
}

/** `cloud_remove_member` (admin-only; self-removal → cloud_leave_org). */
export async function removeCloudMember(
  accessToken: string,
  orgId: string,
  userId: string
): Promise<void> {
  await callManagementRpc("cloud_remove_member", accessToken, {
    p_org_id: orgId,
    p_user_id: userId,
  });
}
