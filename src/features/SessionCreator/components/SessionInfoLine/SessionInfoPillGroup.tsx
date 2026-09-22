import PillGroup, { type PillGroupSegment } from "@src/components/PillGroup";

/** Keep the source/location/branch controls on one bounded, shrinkable row. */
export function SessionInfoPillGroup({
  segments,
  strongSurface = true,
}: {
  segments: PillGroupSegment[];
  strongSurface?: boolean;
}) {
  return (
    <PillGroup
      segments={segments}
      className="max-w-full min-w-0"
      segmentClassName="min-w-12"
      strongSurface={strongSurface}
    />
  );
}
