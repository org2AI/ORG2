import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

import {
  type KeyBinding,
  bindingFromEvent,
  matchesShortcut,
} from "@src/config/keyboard/shortcutBindings";

/** Keep an active press across voice-state renders; release uses the chord that started it. */
export function useVoiceShortcut(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  voice: { start: () => void; stop: () => void }
) {
  const voiceRef = useRef(voice);
  useLayoutEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  useEffect(() => {
    const node = containerRef.current;
    if (!enabled || !node) return;
    let pressed: KeyBinding | undefined;
    const stop = () => {
      if (!pressed) return;
      pressed = undefined;
      voiceRef.current.stop();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || pressed || !matchesShortcut(event, "voice_input"))
        return;
      event.preventDefault();
      event.stopPropagation();
      pressed = bindingFromEvent(event);
      voiceRef.current.start();
    };
    const keyup = (event: KeyboardEvent) => {
      if (!pressed) return;
      const key = bindingFromEvent(event)?.key;
      if (
        key !== pressed.key &&
        !(pressed.ctrl && event.key === "Control") &&
        !(pressed.meta && event.key === "Meta") &&
        !(pressed.alt && event.key === "Alt") &&
        !(pressed.shift && event.key === "Shift")
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      stop();
    };
    node.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", stop);
    return () => {
      node.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", stop);
      stop();
    };
  }, [containerRef, enabled]);
}
