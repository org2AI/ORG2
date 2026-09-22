interface DragLifecycleOptions {
  /** Omit for a mouse session; pointer sessions only accept their owning ID. */
  pointerId?: number;
  onMove: (event: MouseEvent) => void;
  onEnd: (event: MouseEvent) => void;
  onCancel: () => void;
}

/**
 * Listeners belong to one active drag. Detach before notifying its owner so
 * queued/reentrant input cannot write after termination. Disposing on unmount
 * only detaches; owners decide whether to commit, preserve, or discard previews.
 */
export function listenForDrag({
  pointerId,
  onMove,
  onEnd,
  onCancel,
}: DragLifecycleOptions): () => void {
  const moveType = pointerId === undefined ? "mousemove" : "pointermove";
  const endType = pointerId === undefined ? "mouseup" : "pointerup";
  let active = true;
  const owns = (event: MouseEvent) =>
    pointerId === undefined || (event as PointerEvent).pointerId === pointerId;
  const dispose = () => {
    if (!active) return;
    active = false;
    window.removeEventListener(moveType, move, true);
    window.removeEventListener(endType, end, true);
    window.removeEventListener("pointercancel", cancelPointer, true);
    window.removeEventListener("blur", cancel);
    document.removeEventListener("visibilitychange", visibility);
  };
  const cancel = () => {
    if (!active) return;
    dispose();
    onCancel();
  };
  const move = (event: MouseEvent) => {
    if (!active || !owns(event)) return;
    if ((event.buttons & 1) === 0) {
      cancel();
      return;
    }
    onMove(event);
  };
  const end = (event: MouseEvent) => {
    if (!active || !owns(event) || event.button !== 0) return;
    dispose();
    onEnd(event);
  };
  const cancelPointer = (event: PointerEvent) => {
    if (owns(event)) cancel();
  };
  const visibility = () => {
    if (document.visibilityState === "hidden") cancel();
  };
  window.addEventListener(moveType, move, true);
  window.addEventListener(endType, end, true);
  window.addEventListener("pointercancel", cancelPointer, true);
  window.addEventListener("blur", cancel);
  document.addEventListener("visibilitychange", visibility);
  return dispose;
}
