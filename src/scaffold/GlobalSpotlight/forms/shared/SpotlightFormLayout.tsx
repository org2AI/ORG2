import React, { useRef } from "react";

import { SpotlightSearchBar } from "../../components/SpotlightSearchBar";

interface SpotlightFormLayoutProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The standard spotlight path row above a form, with no search input. */
  header: Pick<
    React.ComponentProps<typeof SpotlightSearchBar>,
    "path" | "onRemoveSegment" | "isLoading" | "trailingSlot"
  >;
}

/** Shared header for standalone and embedded spotlight forms. Sections own their padding. */
export function SpotlightFormLayout({
  header,
  children,
  ...props
}: SpotlightFormLayoutProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div {...props}>
      <SpotlightSearchBar
        {...header}
        inputRef={inputRef}
        searchQuery=""
        onSearchQueryChange={() => {}}
        onKeyDown={() => {}}
        placeholder=""
        hideInput
      />
      {children}
    </div>
  );
}
