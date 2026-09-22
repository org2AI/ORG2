import { Placeholder } from "@src/components/Placeholder";

/** Suspense fallback for the lazily loaded History / Pull request / Issues sidebar content. */
export const AlternateModeFallback = () => (
  <Placeholder variant="loading" placement="sidebar" fillParentHeight />
);
