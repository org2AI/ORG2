import React, { Suspense, lazy, useState } from "react";

import SharedSessionFileDialog from "./SharedSessionFileDialog";
import type { SharedSessionFileReference } from "./sharedSessionFileReference";

const SharedSessionFileViewer = lazy(() => import("./SharedSessionFileViewer"));
export default function SharedSessionFileLink({
  href,
  reference,
  children,
}: React.PropsWithChildren<{
  href: string;
  reference: SharedSessionFileReference;
}>) {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <a
        href={href}
        className="text-primary-6 underline-offset-2 hover:underline focus-visible:underline"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpened(true);
        }}
      >
        {children}
      </a>
      {opened && (
        <Suspense
          fallback={
            <SharedSessionFileDialog
              reference={reference}
              onClose={() => setOpened(false)}
            />
          }
        >
          <SharedSessionFileViewer
            reference={reference}
            onClose={() => setOpened(false)}
          />
        </Suspense>
      )}
    </>
  );
}
