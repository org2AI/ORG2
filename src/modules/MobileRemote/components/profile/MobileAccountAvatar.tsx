import React, { useState } from "react";

import PersonAvatar from "@src/components/PersonAvatar";

/** Keep the shared person treatment, with a local fallback for failed profile photos. */
export function MobileAccountAvatar({
  name,
  src,
  size = 40,
}: {
  name: string;
  src?: string;
  size?: number;
}) {
  const [failedSrc, setFailedSrc] = useState<string>();
  let photo: string | undefined;
  try {
    const url = new URL(src ?? "");
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      src !== failedSrc
    )
      photo = src;
  } catch {
    /* A missing or invalid photo uses the canonical initial avatar. */
  }
  return (
    <span
      className="inline-flex shrink-0"
      aria-hidden="true"
      onErrorCapture={() => setFailedSrc(src)}
    >
      <PersonAvatar name={name} src={photo} size={size} />
    </span>
  );
}
