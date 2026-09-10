import { useAtom, useAtomValue } from "jotai";
import React, { Suspense, useEffect } from "react";

import { manualCreatorAtom } from "@src/store/ui/manualCreatorAtom";
import { spotlightOpenAtom } from "@src/store/ui/uiAtom";

const ManualSpotlightCreator = React.lazy(
  () => import("./ManualSpotlightCreator")
);

export function ManualSpotlightCreatorHost() {
  const [request, setRequest] = useAtom(manualCreatorAtom);
  const spotlightOpen = useAtomValue(spotlightOpenAtom);
  useEffect(() => {
    if (spotlightOpen) setRequest(null);
  }, [spotlightOpen, setRequest]);
  if (!request || spotlightOpen) return null;
  return (
    <Suspense fallback={null}>
      <ManualSpotlightCreator
        key={`${request.target}:${request.createProjectContext?.orgId ?? ""}`}
        request={request}
        onClose={() => setRequest(null)}
      />
    </Suspense>
  );
}
