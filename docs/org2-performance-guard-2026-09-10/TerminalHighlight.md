# Lightweight terminal command highlighting

Chat and Agent Station use one synchronous renderer. It decorates at most 256 source characters with at most 24 spans; the rest of the command remains exact plain text. Heredoc bodies remain plain. No HTML is interpreted. Existing `.prism-html .token.*` styles resolve to the same `--cm-syntax-*` variables used by CodeMirror in light and dark themes. No new stylesheet or highlighter library is loaded by this helper.

Chat invokes it only inside the expanded body. The Agent Station command primitive no longer invokes the cached Prism hook. Durable and legacy replay enable the lightweight renderer. Existing explicitly plain and single-line ellipsis variants remain plain; output rendering is unchanged.

| Area               | Verdict           | Evidence                                                   | Change or reason kept                                               | Verification                                                                                             |
| ------------------ | ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Background work    | keep              | Renderer has no effects, subscriptions, timers, or workers | Existing replay ownership unchanged                                 | Source inspection                                                                                        |
| Memory             | bounded candidate | No token cache; capped character scan and spans            | At most 24 extra spans per visible command; arrays are render-local | 200,000-character input stays at 24 spans; 30 updates do not accumulate nodes; unmount removes all nodes |
| Scope/isolation    | keep              | Pure function of caller-provided text                      | No global mutable/session state                                     | Repeated render and escaping tests                                                                       |
| Rendering/hot path | bounded candidate | Expanded chat body and shared station primitive            | Reuse theme classes; remove command Prism hook                      | Rendered chat/station tests; heavy-highlighter hook is never invoked by primitive                        |

Verification: 13 targeted tests passed, `pnpm typecheck:fast` passed, changed-file ESLint passed, and `git diff --check` passed. Tests cover text preservation, HTML escaping, Unicode, heredoc boundaries, token cap, repeated updates, unmount, collapsed chat, and Agent Station output remaining plain.

No browser/WebView RAM measurement or real desktop visual verification was performed. DOM tests establish bounds and removal, not garbage collection or RSS behavior. Source inspection confirms shared color variables; it does not replace theme screenshots.

Performance verdict: blocked for a literal zero-RAM guarantee. The implementation has small bounded markup overhead and no new persistent cache; net application RAM change is unmeasured.
