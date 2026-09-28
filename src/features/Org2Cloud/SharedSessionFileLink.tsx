import React from "react";

import { openSharedSessionFile } from "./openSharedSessionFile";
import { useSharedSessionFileAccess } from "./sharedSessionFileAccess";
import type { SharedSessionFileReference } from "./sharedSessionFileReference";

export default function SharedSessionFileLink({
  href,
  reference,
  children,
}: React.PropsWithChildren<{
  href: string;
  reference: SharedSessionFileReference;
}>) {
  const access = useSharedSessionFileAccess();
  return (
    <a
      href={href}
      className="text-primary-6 underline-offset-2 hover:underline focus-visible:underline"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openSharedSessionFile(reference, access);
      }}
    >
      {children}
    </a>
  );
}
