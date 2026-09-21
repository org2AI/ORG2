/**
 * Simulator App Config Factory
 *
 * Factory for creating SimulatorAppConfig instances with consistent patterns.
 * Uses Rust registry (getAppTypeForTool) as the single source of truth for event matching.
 *
 * ## Benefits
 * - No static event category arrays (uses Rust registry)
 * - Consistent matchesEvent implementation
 * - Reduced boilerplate
 * - Type-safe state derivation
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { getAppTypeForTool } from "@src/engines/SessionCore/rendering/registry/initToolRegistry";

import type { AppType } from "../../types/appTypes";
import type { SimulatorAppBaseState, SimulatorAppConfig } from "./types";

// ============================================
// Types
// ============================================

/**
 * Configuration for creating a simulator app config.
 * The factory handles event matching via Rust registry.
 */
export interface SimulatorAppFactoryConfig<
  TState extends SimulatorAppBaseState,
> {
  /** App type (matches AppType enum) */
  appType: AppType;
  /** Display name */
  name: string;
  /** Icon name (lucide-era slug) */
  icon: string;
  /**
   * Derive app-specific state from filtered events.
   * Events are pre-filtered to only include events for this app.
   */
  deriveState: (
    events: SessionEvent[],
    currentEventId: string | null
  ) => Omit<TState, keyof SimulatorAppBaseState>;
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a simulator app config using Rust registry for event matching.
 *
 * @example
 * export const BROWSER_APP_CONFIG = defineSimulatorAppConfig({
 *   appType: AppType.BROWSER,
 *   name: "Browser",
 *   icon: "Globe",
 *   deriveState: deriveBrowserState,
 * });
 */
export function defineSimulatorAppConfig<TState extends SimulatorAppBaseState>(
  config: SimulatorAppFactoryConfig<TState>
): Omit<SimulatorAppConfig<TState>, "component"> {
  // Event matcher using Rust registry
  const matchesEvent = (eventFunction: string): boolean => {
    return getAppTypeForTool(eventFunction) === config.appType;
  };

  return {
    id: config.appType,
    name: config.name,
    icon: config.icon,
    matchesEvent,
    deriveState: config.deriveState,
  };
}
