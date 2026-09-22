/**
 * Window action icons for the simulator dock context menu.
 */
import {
  ArrowExpand01Icon,
  ArrowLeftRightIcon,
  Cancel01Icon,
  type IconSvgElement,
  MinusSignIcon,
} from "@src/icons";

export const WINDOW_ICONS: Record<string, IconSvgElement> = {
  switchTo: ArrowLeftRightIcon,
  close: Cancel01Icon,
  maximize: ArrowExpand01Icon,
  minimize: MinusSignIcon,
} as const;
