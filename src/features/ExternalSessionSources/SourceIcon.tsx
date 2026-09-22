/**
 * Icon for an external session source (app, CLI, or hook platform): its
 * registered model icon, or a generic terminal glyph when none exists.
 */
import React from "react";

import ModelIcon, { type IconProvider } from "@src/components/ModelIcon";
import { ComputerTerminal01Icon, HugeiconsIcon } from "@src/icons";

interface SourceIconProps {
  iconId: IconProvider;
}

const SourceIcon: React.FC<SourceIconProps> = ({ iconId }) => (
  <ModelIcon
    provider={iconId}
    size={16}
    fallback={
      <HugeiconsIcon
        icon={ComputerTerminal01Icon}
        data-icon="terminal"
        size={16}
        className="text-text-3"
      />
    }
  />
);

export default SourceIcon;
