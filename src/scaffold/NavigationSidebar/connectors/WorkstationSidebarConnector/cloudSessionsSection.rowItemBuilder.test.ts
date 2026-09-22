import { Provider } from "jotai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";

import { useCloudSessionRowItemBuilder } from "./cloudSessionsSection.rowItemBuilder";

vi.mock("@src/config/agentIcons", () => ({
  resolveAgentIcon: () => (props: { size?: number }) =>
    createElement("i", {
      "data-agent-icon": "stub",
      "data-size": props.size,
    }),
}));

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const OWNER_USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const remoteRow: RemoteTeammateSessionMetadata = {
  id: "remote-row-1",
  orgId: ORG_ID,
  ownerMemberId: "member-1",
  ownerUserId: OWNER_USER_ID,
  ownerDisplayName: "Alice",
  ownerIdentityKind: "human",
  sourceSessionId: "source-session-1",
  title: "Cloud-only session",
  eventsEpoch: 1,
  eventsFrozenSeq: 0,
  eventsCount: 1,
  eventsTailHash: "hash",
};

function renderCloudRowAccessory(
  inspect?: (
    item: import("@src/scaffold/NavigationSidebar/components/NavigationMenu/config").NavigationMenuItem
  ) => void
): string {
  const Probe = () => {
    const buildRowItem = useCloudSessionRowItemBuilder({
      presenceMap: {},
      selfUserId: null,
      t: ((key: string) => key) as never,
      tCommon: ((key: string) => key) as never,
      buildNativeMenuItems: () => [],
      busySessionRows: new Map(),
      pinnedRemoteSessionIds: new Set(),
      toggleRemoteSessionPin: vi.fn(),
    });
    const item = buildRowItem({
      row: remoteRow,
      bareSessionId: remoteRow.sourceSessionId,
      isOrphan: false,
    });
    inspect?.(item);
    return createElement("div", null, item.trailingElement);
  };

  return renderToStaticMarkup(
    createElement(Provider, null, createElement(Probe))
  );
}

describe("team session accessories", () => {
  it("keeps only pin and overflow in the row; takeover belongs in the menu", () => {
    const inspect = vi.fn();
    renderCloudRowAccessory(inspect);
    expect(
      inspect.mock.calls[0][0].rowActions.map(
        (action: { label: string }) => action.label
      )
    ).toEqual(["sessions:chat.pinSession", "actions.more"]);
  });
  it("omits the cloud icon and empty accessory wrapper", () => {
    expect(renderCloudRowAccessory()).toBe("<div></div>");
  });
});
