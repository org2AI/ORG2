/**
 * NavigationSidebarSection — one titled group of rows in the session sidebar.
 *
 * The sidebar renders sections in two places, the pinned strip above the list
 * and the scrolling list itself, and both need the identical structure: an
 * optional header (a collapse toggle when `collapsibleSections`, otherwise a
 * static label), then the section's menu rows unless it is collapsed. They used
 * to be two ~60-line copies that had already drifted apart in small ways; this
 * is the single copy.
 *
 * `headerActions` is the only difference the two call sites ever had — the
 * pinned strip passes none.
 */
import type { ComponentProps, ReactNode } from "react";

import Button from "@src/components/Button";
import DisclosureChevron from "@src/components/DisclosureChevron";

import { SIDEBAR_SECTION_LABEL_CLASS, SidebarSectionLabel } from "../blocks";
import NavigationMenu from "./NavigationMenu";
import { NavigationMenuRowActionButton } from "./NavigationMenu/NavigationMenu/RowActionButton";
import type {
  NavigationMenuItem,
  NavigationMenuRowAction,
} from "./NavigationMenu/config";

export interface NavigationMenuSection {
  id: string;
  title?: string;
  /** Leading glyph beside the title (e.g. the pinned-workspace pin). */
  titleIcon?: ReactNode;
  items: NavigationMenuItem[];
  headerActions?: readonly NavigationMenuRowAction[];
}

/**
 * Everything this section hands straight through to its NavigationMenu. Derived
 * from the menu's own props so the two cannot drift.
 */
type MenuPassThroughProps = Pick<
  ComponentProps<typeof NavigationMenu>,
  | "selectedKeys"
  | "defaultOpenKeys"
  | "onMenuItemClick"
  | "onMenuItemContextMenu"
  | "renderMenuItemWrapper"
>;

export interface NavigationSidebarSectionProps extends MenuPassThroughProps {
  section: NavigationMenuSection;
  /** Header doubles as a collapse toggle rather than a static label. */
  collapsibleSections: boolean;
  collapsed: boolean;
  onToggle: (sectionId: string) => void;
}

export default function NavigationSidebarSection({
  section,
  collapsibleSections,
  collapsed,
  onToggle,
  selectedKeys,
  defaultOpenKeys,
  onMenuItemClick,
  onMenuItemContextMenu,
  renderMenuItemWrapper,
}: NavigationSidebarSectionProps) {
  const toggle = () => {
    onToggle(section.id);
  };

  return (
    <div data-sidebar-section-id={section.id}>
      {section.title &&
        (collapsibleSections ? (
          <div
            data-sidebar-section-toggle={section.id}
            role="button"
            tabIndex={0}
            aria-expanded={!collapsed}
            className={`${collapsed ? "" : "mb-px"} group/section-title flex h-7 cursor-pointer items-center gap-1 pl-2`}
            onClick={toggle}
            onKeyDown={(event) => {
              if (
                event.target !== event.currentTarget ||
                (event.key !== "Enter" && event.key !== " ")
              ) {
                return;
              }
              event.preventDefault();
              toggle();
            }}
          >
            <span className="flex min-w-0 items-center gap-2">
              {section.titleIcon}
              <span className={SIDEBAR_SECTION_LABEL_CLASS}>
                {section.title}
              </span>
              <span
                className={`${collapsed ? "inline-flex" : "hidden"} -ml-1 shrink-0 items-center leading-none text-text-2 group-hover/section-title:inline-flex`}
              >
                <Button
                  variant="tertiary"
                  size="sidebar"
                  iconOnly
                  aria-label={section.title ?? section.id}
                  title={section.title ?? section.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle();
                  }}
                  icon={
                    <DisclosureChevron
                      expanded={!collapsed}
                      size={14}
                      strokeWidth={2}
                      className="text-text-2"
                    />
                  }
                />
              </span>
            </span>
            {section.headerActions && (
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 leading-none text-text-2">
                {section.headerActions.map((action) => (
                  <span
                    key={action.label}
                    className={
                      section.headerActions?.some(
                        (headerAction) => headerAction.active
                      )
                        ? "inline-flex"
                        : action.showOnSidebarHover
                          ? "hidden group-hover/sidebar:inline-flex group-focus-visible/section-title:inline-flex group-has-[:focus-visible]/section-title:inline-flex"
                          : "hidden group-hover/section-title:inline-flex group-focus-visible/section-title:inline-flex group-has-[:focus-visible]/section-title:inline-flex"
                    }
                  >
                    <NavigationMenuRowActionButton
                      icon={action.icon}
                      iconClassName={action.iconClassName}
                      label={action.label}
                      active={action.active}
                      dataTestId={action.dataTestId}
                      onClick={action.onClick}
                    />
                  </span>
                ))}
              </span>
            )}
          </div>
        ) : (
          <SidebarSectionLabel label={section.title} icon={section.titleIcon} />
        ))}
      {!collapsed && (
        <NavigationMenu
          items={section.items}
          selectedKeys={selectedKeys}
          collapsed={false}
          defaultOpenKeys={defaultOpenKeys}
          onMenuItemClick={onMenuItemClick}
          onMenuItemContextMenu={onMenuItemContextMenu}
          renderMenuItemWrapper={renderMenuItemWrapper}
        />
      )}
    </div>
  );
}
