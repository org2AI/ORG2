export {
  buildAccountLookup,
  useModelAccountLookup,
} from "./useModelAccountLookup";
export { resolveModelDisplaySelection } from "./resolveModelDisplaySelection";
export { useModelEffortSegment } from "./useModelEffortSegment";
export {
  getRustCompatibleAccounts,
  useAgentCompatibility,
} from "./useAgentCompatibility";

// Desktop consumers import useValidatedLastPair directly; its Market owner
// checks depend on native auth and must stay outside this shared barrel.
export { useModelAliasRegistry } from "./useModelAliasRegistry";
export {
  useModelPillLabel,
  useResolvedModelLabel,
} from "./useResolvedModelLabel";
