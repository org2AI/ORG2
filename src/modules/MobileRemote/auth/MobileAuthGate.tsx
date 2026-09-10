import React from "react";

import { MobileAuthContext } from "./MobileAuthContext";
import { MobileAuthScreen } from "./MobileAuthScreen";
import type { MobileAuthClient } from "./mobileAuthClient";
import { useMobileAuthController } from "./useMobileAuthController";

export interface MobileAuthGateRenderProps {
  authUserId: string;
  recoveredPairingIntent: string | null;
}

export interface MobileAuthGateProps {
  children: (props: MobileAuthGateRenderProps) => React.ReactNode;
  /** Test seam; production uses the browser-safe official Cloud client. */
  client?: MobileAuthClient;
  navigate?: (url: string) => void;
}

export function MobileAuthGate({
  children,
  client,
  navigate,
}: MobileAuthGateProps) {
  const { state, contextValue, startSignIn, cancelSignIn, retry } =
    useMobileAuthController({ client, navigate });
  if (state.phase !== "signed_in" || !contextValue) {
    return (
      <MobileAuthScreen
        state={state}
        onSignIn={startSignIn}
        onCancel={cancelSignIn}
        onRetry={() => void retry()}
      />
    );
  }

  return (
    <MobileAuthContext.Provider value={contextValue}>
      {children({
        authUserId: state.session.userId,
        recoveredPairingIntent: state.recoveredPairingIntent,
      })}
    </MobileAuthContext.Provider>
  );
}

MobileAuthGate.displayName = "MobileAuthGate";
