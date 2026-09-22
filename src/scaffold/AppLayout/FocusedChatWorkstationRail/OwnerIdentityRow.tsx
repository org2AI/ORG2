/** Cloud session owner row, using the shared people-avatar treatment. */
import PersonAvatar from "@src/components/PersonAvatar";
import {
  WORKSTATION_TRAIL_ROW,
  WORKSTATION_TRAIL_ROW_HOVER_CLASS,
} from "@src/components/layout/tokens/workstationTrailTokens";

import type { FocusedChatSessionContext } from "./types";

export function OwnerIdentityRow({
  compact = false,
  owner,
}: {
  compact?: boolean;
  owner: NonNullable<FocusedChatSessionContext["owner"]>;
}) {
  const displayName = owner.displayName?.trim();
  const identityLabel = displayName || owner.identityId;
  const title =
    displayName && displayName !== owner.identityId
      ? `${identityLabel} · ${owner.identityId}`
      : identityLabel;
  const rowClass = `${WORKSTATION_TRAIL_ROW.shell} ${compact ? WORKSTATION_TRAIL_ROW.compact : WORKSTATION_TRAIL_ROW.wide} ${WORKSTATION_TRAIL_ROW_HOVER_CLASS}`;
  const contentClass = `${WORKSTATION_TRAIL_ROW.content} ${compact ? WORKSTATION_TRAIL_ROW.compactContent : WORKSTATION_TRAIL_ROW.wideContent}`;

  return (
    <div
      className={`${rowClass} ${contentClass}`}
      title={title}
      data-owner-id={owner.identityId}
      data-testid="session-environment-owner"
    >
      <span className={WORKSTATION_TRAIL_ROW.icon}>
        <PersonAvatar
          name={displayName || owner.identityId}
          src={owner.avatarUrl}
          size={WORKSTATION_TRAIL_ROW.iconSize}
        />
      </span>
      <span className={WORKSTATION_TRAIL_ROW.label}>{identityLabel}</span>
    </div>
  );
}
