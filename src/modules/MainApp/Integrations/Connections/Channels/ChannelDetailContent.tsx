/**
 * ChannelDetailContent
 *
 * Renders the config form for a given channel type.
 */
import React from "react";

import ChannelConfigFields from "./ChannelConfigFields";

export interface ChannelDetailProps {
  channelType: string;
  config: Record<string, unknown>;
  update: (path: string, value: unknown) => void;
  pathPrefix: string;
}

const ChannelDetailContent: React.FC<ChannelDetailProps> = ({
  channelType,
  config,
  update,
  pathPrefix,
}) => (
  <ChannelConfigFields
    channelType={channelType}
    config={config}
    update={update}
    pathPrefix={pathPrefix}
  />
);

export default ChannelDetailContent;
