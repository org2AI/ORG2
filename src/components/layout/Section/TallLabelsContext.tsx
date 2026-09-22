import React, { createContext, useContext } from "react";

/**
 * When true, single-line SectionRow labels (no description) render at a
 * 32px line height instead of the default 22px, to align with 32px input
 * controls. Wizards opt into this via TallSectionLabelsProvider; Settings
 * pages keep the default density.
 */
const TallLabelsContext = createContext(false);

export const TallSectionLabelsProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => (
  <TallLabelsContext.Provider value={true}>
    {children}
  </TallLabelsContext.Provider>
);

export function useTallSectionLabels(): boolean {
  return useContext(TallLabelsContext);
}
