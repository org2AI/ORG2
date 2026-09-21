import React from "react";

interface TabBarLeadingLayoutProps {
  children: React.ReactNode;
  /** Keep the leading controls tight to the first tab when needed. */
  trailingPadding?: boolean;
}

export const TabBarLeadingLayout: React.FC<TabBarLeadingLayoutProps> = ({
  children,
  trailingPadding = true,
}) => (
  <div
    className={`flex items-center gap-1 ${trailingPadding ? "pr-2" : "pr-0"} pl-1.5`}
  >
    {children}
  </div>
);

export default TabBarLeadingLayout;
