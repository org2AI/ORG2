import { AppBootstrap } from "@src/app/root/AppBootstrap";
import { AppProviders } from "@src/app/root/AppProviders";
import ErrorBoundary from "@src/app/root/components/ErrorBoundary";
// WorkStation owns the editor / git / terminal / file action surface and
// registers it into the scaffold action system (see
// `scaffold/ActionSystem/coreActionProvider`). Imported for that side effect at
// the composition root so the provider is installed before any
// `ActionSystemProvider` mounts — the scaffold must not import it itself.
import "@src/modules/WorkStation/actions/install";

const App = () => {
  return (
    <AppProviders>
      {/*
       * Top-level ErrorBoundary ABOVE AppBootstrap. AppBootstrap's own hooks
       * (useSettingsSync, useAppDeferredInitialization, etc.) run outside the
       * ErrorBoundary that lives inside AppBootstrap, so a synchronous throw in
       * any of them would otherwise escape to React's onUncaughtError and leave
       * the user stranded on the splash. Catching it here renders the error
       * page instead. Placed inside AppProviders so it can read the Jotai store.
       */}
      <ErrorBoundary>
        <AppBootstrap />
      </ErrorBoundary>
    </AppProviders>
  );
};

export default App;
