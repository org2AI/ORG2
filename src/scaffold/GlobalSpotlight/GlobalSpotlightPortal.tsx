/**
 * Global Spotlight Portal Component
 *
 * Mounts the GlobalSpotlight when its open atom is true. The spotlight
 * itself owns its chrome (portal, surface, positioning, footer) via
 * SpotlightShell — this wrapper is just an open-state binding.
 */
import { useAtom } from "jotai";
import React, { Suspense } from "react";

import { ManualSpotlightCreatorHost } from "@src/modules/ProjectManager/shared/components/ManualSpotlightCreatorHost";
import { spotlightOpenAtom } from "@src/store/ui/uiAtom";

const GlobalSpotlight = React.lazy(() =>
  import("@/src/scaffold/GlobalSpotlight").then((module) => ({
    default: module.GlobalSpotlight,
  }))
);

export const GlobalSpotlightPortal: React.FC = () => {
  const [spotlightOpen, setSpotlightOpen] = useAtom(spotlightOpenAtom);

  return (
    <>
      <ManualSpotlightCreatorHost />
      {spotlightOpen && (
        <Suspense fallback={null}>
          <GlobalSpotlight
            isOpen={true}
            onClose={() => setSpotlightOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
};
