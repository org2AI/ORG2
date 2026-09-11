import React from "react";

import AnyIcon from "@src/components/AnyIcon";
import Button from "@src/components/Button";
import { MoreHorizontalIcon } from "@src/icons";

import type { NavigationMenuItem } from "../config";

interface NavigationMenuRowActionButtonProps {
  icon?: NavigationMenuItem["rowActionIcon"];
  dataIcon?: string;
  iconClassName?: string;
  label: string;
  active?: boolean;
  dataTestId?: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export function NavigationMenuRowActionButton({
  icon,
  dataIcon,
  iconClassName,
  label,
  active,
  dataTestId,
  onClick,
}: NavigationMenuRowActionButtonProps): React.ReactElement {
  const RowActionIcon = icon ?? MoreHorizontalIcon;

  return (
    <Button
      htmlType="button"
      size="sidebar"
      variant="tertiary"
      appearance="soft"
      iconOnly
      aria-label={label}
      aria-pressed={active}
      title={label}
      data-testid={dataTestId}
      className="focus:outline-none"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick(event);
      }}
      icon={
        <AnyIcon
          icon={RowActionIcon}
          data-icon={dataIcon ?? (icon ? undefined : "ellipsis")}
          size={14}
          strokeWidth={icon ? 2 : 1.75}
          className={iconClassName}
        />
      }
    />
  );
}
