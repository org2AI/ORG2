import type { ReactNode } from "react";

import Button, { type ButtonProps } from "@src/components/Button";
import { NoDragRegion } from "@src/components/WindowChrome";

type FloatingLauncherProps = Pick<
  ButtonProps,
  "onClick" | "aria-expanded" | "aria-haspopup" | "disabled"
> & {
  label: string;
  icon: ReactNode;
  "data-testid"?: string;
};

/** The common corner action; callers own labels, icons and domain actions. */
export function FloatingLauncher({
  label,
  icon,
  ...props
}: FloatingLauncherProps) {
  return (
    <NoDragRegion className="pointer-events-auto">
      <Button
        {...props}
        variant="primary"
        size="large"
        shape="circle"
        iconOnly
        icon={icon}
        className="shadow-lg"
        title={label}
        aria-label={label}
      />
    </NoDragRegion>
  );
}

/** DOM order is also visual and keyboard order; absent actions leave no gap. */
export function FloatingLauncherStack({ children }: { children?: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute right-4 bottom-4 z-70 flex flex-col items-end gap-2"
      data-floating-launcher-stack
    >
      {children}
    </div>
  );
}
