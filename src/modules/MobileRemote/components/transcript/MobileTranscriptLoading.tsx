import React, { useEffect, useState } from "react";

import { useMobileRemotePlatform } from "../../platform";
import "./mobileTranscriptLoading.scss";

export function MobileLoadingDots({ label }: { label: string }) {
  const { runtime } = useMobileRemotePlatform();
  const [hidden, setHidden] = useState(() => runtime.isHidden());
  useEffect(() => {
    const update = () => setHidden(runtime.isHidden());
    update();
    return runtime.subscribeVisibility(update);
  }, [runtime]);
  return (
    <div
      className="mobile-loading-dots"
      role="status"
      aria-label={label}
      aria-busy="true"
      data-paused={hidden}
    >
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
}

export function MobileTranscriptLoading({ label }: { label: string }) {
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center"
      data-mobile-transcript-loading="true"
    >
      <MobileLoadingDots label={label} />
    </div>
  );
}
