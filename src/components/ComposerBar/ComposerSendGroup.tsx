import type { ReactNode } from "react";

/** Shared microphone/send spacing for session creation and in-session composers. */
export default function ComposerSendGroup({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="flex h-7 shrink-0 items-center gap-1">{children}</div>;
}
