import type { Virtualizer } from "@tanstack/react-virtual";

/** Own both the listener and its trailing callback for the vertical picker. */
export function observePickerScrollOffset(
  instance: Pick<
    Virtualizer<HTMLDivElement, Element>,
    "scrollElement" | "targetWindow"
  > & { options: { isScrollingResetDelay: number } },
  onChange: (offset: number, isScrolling: boolean) => void
) {
  const element = instance.scrollElement;
  const targetWindow = instance.targetWindow;
  if (!element || !targetWindow) return;

  let timer: number | undefined;
  const onScroll = () => {
    const offset = element.scrollTop;
    targetWindow.clearTimeout(timer);
    timer = targetWindow.setTimeout(() => {
      timer = undefined;
      onChange(offset, false);
    }, instance.options.isScrollingResetDelay);
    onChange(offset, true);
  };
  element.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    element.removeEventListener("scroll", onScroll);
    targetWindow.clearTimeout(timer);
  };
}
