import React from "react";

// ============================================
// Lazy page components
// ============================================

export const AgentOrgsPage = React.lazy(
  () =>
    import(/* webpackChunkName: "mainapp" */ "@src/modules/MainApp/AgentOrgs")
);

export const MyRolePage = React.lazy(
  () => import(/* webpackChunkName: "mainapp" */ "@src/modules/MainApp/MyRole")
);

// Supabase OAuth callback — NOT a market feature. Required for login to work
// in any build (OSS or hosted). Path stays "/orgii/marketplace/callback"
// so existing desktop deep-link routing remains stable.
export const AuthCallback = React.lazy(
  () =>
    import(
      /* webpackChunkName: "auth-callback" */ "@src/modules/AppLogin/AuthCallback"
    )
);

export const LoginPage = React.lazy(
  () => import(/* webpackChunkName: "auth" */ "@/src/modules/AppLogin")
);

// Detached session window (label `app-window-session-<id>`): one session
// surface with no app shell. Opened by `open_session_window` (Rust).
export const SessionWindowPage = React.lazy(
  () => import(/* webpackChunkName: "workspace" */ "@src/modules/SessionWindow")
);

// Detached station window (label `app-window-station-<mode>`): My Station or
// Agent Station alone, no sidebar or chat panel. Opened by
// `open_station_window` (Rust).
export const StationWindowPage = React.lazy(
  () =>
    import(/* webpackChunkName: "workstation" */ "@src/modules/StationWindow")
);

export const MobileRemotePage = React.lazy(
  () =>
    import(
      /* webpackChunkName: "mobile-remote" */ "@src/modules/MobileRemote/BrowserMobileRemotePage"
    )
);

// Route preloading functions live in ./preload.ts (cycle-free)
