# Missing regular-file diff markers

Git HEAD and the current editor buffer are the authoritative comparison inputs. Git status deliberately omits file bodies. Previously, regular tabs treated an unavailable HEAD body as permission to fall back to the saved disk content. Saved modified files could therefore compare equal while their tabs correctly showed `M`.

The active regular-file renderer now loads the missing HEAD baseline through the existing shared working-tree diff resource. A Git-status file does not fall back to disk content while HEAD is unavailable. Missing or failed loads remain unavailable rather than becoming an invented empty file. Added files still compare against an empty baseline. No persisted data was malformed and no historical cleanup is needed.

The async dirty-marker producer now rejects results computed for an obsolete document/baseline snapshot. Backend failures retain existing markers instead of publishing an empty map. The next queued computation uses the current snapshot.

| Area               | Verdict | Evidence                                                                     | Change or reason kept                                                   | Verification                               |
| ------------------ | ------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| Background work    | fix     | Active-file effects and existing single-flight debounce                      | No polling; obsolete responses ignored; queued timer cleared on destroy | Inactive-tab, stale-result and close tests |
| Memory             | keep    | Existing shared resource has four-entry/8 MiB bounds                         | No new global cache; release settled resource on effect cleanup         | Resource-bound and release tests           |
| Scope/isolation    | fix     | Repository/worktree, path, original path, status and stage identify requests | Loaded baseline is exposed only for its matching key                    | File-switch response test                  |
| Rendering/hot path | fix     | Marker results require the original snapshot                                 | Do not dispatch stale results or clear markers on failure               | Lifecycle regression tests                 |

Tests exercise actual hooks and CodeMirror DOM with mocked transport, plus existing shared-resource tests. No UI style changes are included. Live Git transport recovery, Tauri rendering, visible/hidden idle CPU and RSS remain unmeasured. Performance verdict: blocked for those desktop measurements; no performance improvement is claimed.
