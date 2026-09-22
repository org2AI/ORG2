/**
 * Edge-triggered streaming flag writer: only forwards a value change, so the
 * EventStore streaming flag is written once per transition, not per delta.
 */

export interface StreamingEdgeController {
  readonly value: boolean;
  set(value: boolean): void;
}

export function createStreamingEdgeController(
  write: (value: boolean) => void
): StreamingEdgeController {
  let lastValue: boolean | undefined;
  return {
    get value(): boolean {
      return lastValue ?? false;
    },
    set(value: boolean): void {
      if (lastValue === value) return;
      lastValue = value;
      write(value);
    },
  };
}
