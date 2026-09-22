import { useEffect, useRef, useState } from "react";

import { useMobileRemotePlatform } from "../../platform/MobileRemotePlatformContext";

type CopyState = "idle" | "pending" | "copied" | "failed";

/** One-shot clipboard action shared by chat snippets and the file viewer. */
export function useMobileCopyText(text: string) {
  const platform = useMobileRemotePlatform();
  const [result, setResult] = useState<{
    text: string;
    owner: typeof platform;
    state: CopyState;
  } | null>(null);
  if (result && (result.text !== text || result.owner !== platform))
    setResult(null);
  const state =
    result?.text === text && result.owner === platform ? result.state : "idle";
  const generation = useRef(0);
  const pending = useRef(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      generation.current += 1;
      pending.current = false;
      if (timer.current !== null) platform.runtime.clearTimeout(timer.current);
      timer.current = null;
    },
    [text, platform]
  );

  const copy = () => {
    if (pending.current) return;
    pending.current = true;
    const attempt = ++generation.current;
    setResult({ text, owner: platform, state: "pending" });
    const finish = (next: CopyState) => {
      if (attempt !== generation.current) return;
      generation.current += 1;
      pending.current = false;
      if (timer.current !== null) platform.runtime.clearTimeout(timer.current);
      timer.current = null;
      setResult({ text, owner: platform, state: next });
    };
    timer.current = platform.runtime.setTimeout(() => finish("failed"), 3_000);
    try {
      if (!platform.writeClipboardText) return finish("failed");
      void platform.writeClipboardText(text).then(
        () => finish("copied"),
        () => finish("failed")
      );
    } catch {
      finish("failed");
    }
  };
  return { state, copy };
}
