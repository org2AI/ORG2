/**
 * Shared types for the `Message` toast system.
 */
import type { ReactNode, Ref } from "react";

export type MessageType = "success" | "error" | "warning" | "info" | "regular";
export type MessagePlacement = "bottom" | "spotlight";

export interface SpotlightMessageConfig extends MessageConfig {
  /** Visual tone. Overrides type when supplied; defaults to regular. */
  variant?: "success" | "danger" | "regular";
}

export interface MessageConfig {
  content: ReactNode;
  type?: MessageType;
  /** Where the message is presented. Defaults to the bottom toast stack. */
  placement?: MessagePlacement;
  duration?: number;
  closable?: boolean;
  onClose?: () => void;
  /** Optional custom icon for success and info toasts. */
  icon?: ReactNode;
  className?: string;
  id?: string;
  /** Keep this message from being evicted by the three-message soft limit. */
  persistent?: boolean;
  /** Optional title for the message */
  title?: string;
  /** Optional download action shown in the toast */
  download?: {
    fileName: string;
    content: string | Blob;
    mimeType?: string;
    label?: string;
  };
  /** Optional cancel action shown in the toast */
  cancel?: {
    label?: string;
    onClick?: () => void;
    closeOnClick?: boolean;
  };
  /** Optional primary action shown in the toast. */
  action?: {
    label: string;
    onClick: () => void;
    closeOnClick?: boolean;
  };
}

export interface MessageItemProps extends MessageConfig {
  id: string;
  onRemove: (id: string) => void;
  ref?: Ref<HTMLDivElement>;
}

export const DEFAULT_DURATION = 1000;
