import { type ReactNode, createContext, useContext } from "react";
import { createPortal } from "react-dom";

/** The mounted section body owns its actions and their loading state. */
export const SectionHeaderActionsContext = createContext<HTMLDivElement | null>(
  null
);

export function SectionHeaderActions({ children }: { children: ReactNode }) {
  const host = useContext(SectionHeaderActionsContext);
  return host ? createPortal(children, host) : null;
}
