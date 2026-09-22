# Launchpad Spotlight opening transition

| Area               | Verdict | Evidence                                                                    | Change or reason kept                                                                      | Verification                                                                            |
| ------------------ | ------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Background work    | keep    | One 240ms Web Animation, one visibility listener only while animating       | Finish, close, hide and unmount cancel it; no polling or per-frame React updates           | Hidden/cancel and immediate-close tests pass                                            |
| Memory             | keep    | One temporary inert DOM snapshot and one source element reference           | Snapshot removed on completion/cancellation; source cleared on close/unmount               | Close/reopen/unmount test passes                                                        |
| Scope/isolation    | keep    | Source is a non-persisted Jotai atom; set only by Launchpad pill activation | Other openers retain normal behavior; no account/network/provider changes                  | Source removal and atom cleanup tested                                                  |
| Rendering/hot path | keep    | Two geometry reads on opening; native transform/opacity animation           | No delayed unmount or closing animation; normal Spotlight input tree remains authoritative | Opening cancellation restores live opacity; reduced-motion and absent-source tests pass |

Lifecycle: idle has no animation/listener/snapshot. Opening while hidden or with reduced motion skips animation. Hiding during opening cancels it. Closing removes live search immediately and cancels unfinished opening. Reopening creates a new bounded snapshot. Network, identity and provider transitions are not changed.

Verification: `pnpm test src/scaffold/GlobalSpotlight/useLaunchpadTransition.test.ts` passed (5 tests). Native Tauri CPU/RSS and frame pacing were not measured because desktop control was not authorized. User reported opening looks good; this is visual feedback, not a performance measurement.

Performance verdict: blocked for native frame-pacing and CPU/RSS measurement; automated lifecycle checks pass.
