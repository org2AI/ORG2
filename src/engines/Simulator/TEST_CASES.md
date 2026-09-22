# Test Cases: ActivitySimulator (Simulator Engine)

## Preconditions

- A completed session exists with at least one recorded event sequence.
- The `ActivitySimulator` is rendered inside a full Jotai + React Router + i18n provider tree.
- Simulator atoms (`replayModeAtom`, `simulatorSelectedAppAtom`, etc.) are at default values.
- The session's event array is non-empty and has been processed by `mergeSessionEventsToolResultsByCallId`.

## Happy Path

| #   | Steps                                             | Expected Result                                                           |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | Open a completed session; Simulator mounts.       | First event is displayed in `ActivitySimulatorGrid`; Dock chrome visible. |
| 2   | Press "Play" on `DockReplayControl`.              | Events advance step by step; `displayEvent` updates on each tick.         |
| 3   | Press "Pause".                                    | Playback stops at current event; UI frozen at that state.                 |
| 4   | Drag the `MusicPlayerReplayBar` scrubber to 50%.  | `displayEvent` jumps to the midpoint event; no crash.                     |
| 5   | Click "Next step" arrow.                          | Advances by one event; display updates.                                   |
| 6   | Click "Prev step" arrow.                          | Steps back by one event; display updates.                                 |
| 7   | Switch to a different app tab in the Dock.        | `simulatorSelectedAppAtom` updates; grid reflects new app view.           |
| 8   | Session has subagents; `SubagentPipCard` renders. | Pip cards displayed below main grid; clicking one sets active subagent.   |
| 9   | Chat panel visible; floating input shown.         | `SimulatorFloatingInput` is rendered when `chatVisible=true`.             |
| 10  | Session has multiple execution threads.           | Grid layout is derived from the thread count automatically.               |

## Edge Cases

| #   | Scenario                                | Steps                                                 | Expected Result                                                             |
| --- | --------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Empty event list                        | Open a session with zero events.                      | Empty-state UI or first-frame placeholder shown; no crash.                  |
| 2   | Single event session                    | Open session with exactly one event.                  | Play/pause/scrub work; prev/next arrows disabled or clamped.                |
| 3   | Rapid step navigation                   | Click "Next" 50 times faster than render cycle.       | Index clamps at last event; no index out-of-bounds error.                   |
| 4   | Scrub to exact start                    | Drag scrubber to 0%.                                  | First event shown; prev arrow disabled.                                     |
| 5   | Scrub to exact end                      | Drag scrubber to 100%.                                | Last event shown; next arrow disabled.                                      |
| 6   | App switching mid-replay                | Switch active app while replay is running.            | Replay continues; new app view reflects current event.                      |
| 7   | Session with large event count (> 1000) | Open session with 1000+ events; replay.               | No performance degradation; scrubber resolves index with `findIndexAtTime`. |
| 8   | Skip empty "running" events             | Replay sequence has consecutive running-state events. | `skipEmptyRunningEvent` advances past them without pausing UI.              |
| 9   | Follow-agent lock                       | `simulatorFollowAppLockAtom=true`; playback runs.     | App view auto-switches to follow agent's active app.                        |
| 10  | Collapse inline chat                    | Click collapse button on `SimulatorFloatingInput`.    | `simulatorInlineChatInputCollapsedAtom` toggles; input hides/shows.         |

## Error / Degraded States

| #   | Scenario                     | Steps                                                              | Expected Result                                         |
| --- | ---------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| 1   | Session load error           | Session atom resolves with error.                                  | Error state shown; no blank white screen.               |
| 2   | Subagent session unavailable | `useSimulatorSubagents` returns empty list.                        | Main grid still renders; pip card area empty or hidden. |
| 3   | Tool result merge failure    | `mergeSessionEventsToolResultsByCallId` receives malformed events. | Partial results shown; no crash.                        |

## Accessibility

- [ ] Keyboard-navigable (Tab to Dock controls; Arrow keys for prev/next step)
- [ ] Screen reader label present on play/pause button
- [ ] Focus trap not applicable (full-page simulator, not a modal)

## Acceptance Criteria

- [ ] Replay advances event-by-event with Play; pauses with Pause
- [ ] Scrubber seeks to the correct event by timestamp
- [ ] Prev/next step arrows clamp at boundaries
- [ ] App switching updates the grid view without breaking replay state
- [ ] Subagent pip cards render when subagents are present
- [ ] Empty event list shows empty state without crash
- [ ] `pnpm test` passes with no new failures
- [ ] No TypeScript errors (`pnpm typecheck`)
