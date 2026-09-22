/**
 * Core action provider seam.
 *
 * The scaffold owns the action *mechanism* — the registry, the Zod schema layer,
 * the dispatcher — plus the app-level actions in `./actions`. Surface-specific
 * action sets (today: WorkStation's editor / git / terminal / file actions) are
 * NOT imported from here. They register themselves INTO this seam during their
 * own initialisation, so `src/scaffold/ActionSystem/` never reaches up into
 * `src/modules/`.
 *
 * `initializeServices`, `registerCoreActions` and `cleanupServices` keep the
 * exact names and signatures the scaffold used to import directly from
 * WorkStation, so every call site — `ActionSystemProvider`, the agent ADE
 * bridge — is unchanged apart from where it imports them from. With no provider
 * installed they are no-ops, which is what a surface-less host (a unit test that
 * only exercises app-level actions) already behaved like.
 */

export interface CoreActionProvider {
  /** Point the surface's services at the active repository. */
  initializeServices: (repoPath: string, repoId?: string) => Promise<void>;
  /** Register the surface's actions; returns its own (ref-counted) cleanup. */
  registerCoreActions: (repoPath: string) => () => void;
  /** Tear the surface's services down. */
  cleanupServices: () => void;
}

const providers: CoreActionProvider[] = [];

/**
 * Install a surface's action provider. Idempotent for the same object.
 *
 * @returns an uninstall function (used by tests; the app installs for the
 *          lifetime of the window).
 */
export function registerCoreActionProvider(
  provider: CoreActionProvider
): () => void {
  if (!providers.includes(provider)) {
    providers.push(provider);
  }

  return () => {
    const index = providers.indexOf(provider);
    if (index !== -1) {
      providers.splice(index, 1);
    }
  };
}

/** Initialize every installed surface's services for `repoPath`. */
export async function initializeServices(
  repoPath: string,
  repoId?: string
): Promise<void> {
  await Promise.all(
    providers.map((provider) => provider.initializeServices(repoPath, repoId))
  );
}

/**
 * Register every installed surface's actions on the global Zod registry.
 *
 * @returns a cleanup that unregisters them in reverse installation order.
 */
export function registerCoreActions(repoPath: string): () => void {
  const cleanups = providers.map((provider) =>
    provider.registerCoreActions(repoPath)
  );

  return () => {
    for (const cleanup of [...cleanups].reverse()) {
      cleanup();
    }
  };
}

/** Clean up every installed surface's services. */
export function cleanupServices(): void {
  for (const provider of providers) {
    provider.cleanupServices();
  }
}
