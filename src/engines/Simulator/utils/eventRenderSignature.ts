/**
 * Render signatures for simulator memo comparators.
 *
 * A signature captures every field of a SessionEvent that affects what the
 * simulator draws, so memoized cells can skip re-rendering when an event
 * object is replaced by an equal copy but still re-render on in-place
 * streaming updates.
 */
import type { SessionEvent } from "@src/engines/SessionCore";

type RenderSignatureEvent =
  | (SessionEvent & { lastActivityAt?: string })
  | null
  | undefined;

export function getEventRenderSignature(event: RenderSignatureEvent): string {
  if (!event) return "";
  return [
    event.id,
    event.chunk_id ?? "",
    event.functionName,
    event.displayStatus,
    event.displayText,
    event.displayVariant,
    event.lastActivityAt ?? "",
    event.args ? JSON.stringify(event.args) : "",
    event.result ? JSON.stringify(event.result) : "",
    event.extracted ? JSON.stringify(event.extracted) : "",
    event.payloadRefs ? JSON.stringify(event.payloadRefs) : "",
  ].join("|");
}
