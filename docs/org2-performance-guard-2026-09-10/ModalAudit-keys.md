# Modal lifecycle review

| Area               | Verdict | Evidence                                                       | Change or reason kept                                                          | Verification                                                                            |
| ------------------ | ------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Background work    | keep    | Modal owns one opening-focus timeout plus Escape/Tab listeners | Start only while mounted; shared cleanup runs on unmount                       | Rendered test asserts Escape stops after close and quick close clears the focus timeout |
| Memory             | keep    | Overlay contribution belongs to mounted modal                  | Unmount returns store count to baseline; no cache or retained key copies added | Repeated mount/unmount test                                                             |
| Scope/isolation    | keep    | Overlay reference uses the active Jotai store                  | Provider-scoped store; no identity/network requests added                      | Isolated-store test                                                                     |
| Rendering/hot path | keep    | Credential data supplied by parent                             | Existing validation and card callbacks retained                                | Selection and token-detection tests                                                     |

Lifecycle: closed/start/after-close owns no modal listener or overlay reference; open/active owns one of each. Hidden documents receive no new recurring work; the existing one-shot focus timeout is not changed. Network/account/scope changes do not create a new request or cache here. App shutdown follows unmount cleanup. Native webview layering and CPU/RSS were not measured.

Performance verdict: blocked for real Tauri layering/measurement verification because computer control was not authorized. Automated resource-lifecycle checks pass; no measured performance claim is made.
