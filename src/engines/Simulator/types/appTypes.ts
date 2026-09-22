/**
 * Simulator dock app ids.
 *
 * The declarations moved down to `@src/contracts/simulator/appType` so
 * `store/ui/simulatorAtom` can name them without importing `engines/`.
 * This module stays as the Simulator-facing facade.
 */

export * from "@src/contracts/simulator/appType";
