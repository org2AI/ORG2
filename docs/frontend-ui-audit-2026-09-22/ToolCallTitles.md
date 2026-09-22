# Tool call titles UI audit

| Line                                                                           | Element                 | Verdict          | Reason                                                                                                                                              | Suggested change |
| ------------------------------------------------------------------------------ | ----------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/engines/ChatPanel/blocks/ToolCallBlock/index.tsx:358`                     | Invocation title        | keep with reason | Uses existing EventBlockHeaderTitle truncation and hover-title props. No new control or visual shell.                                               | None.            |
| `src/modules/MobileRemote/components/transcript/MobileToolCall.tsx:105`        | Mobile invocation title | keep with reason | Uses the same shared title slot; removes an identical subtitle while keeping status visible. Existing Button remains the detail action.             | None.            |
| `src/modules/WorkStation/CodeEditor/SessionReplay/CodePanel/ToolPanel.tsx:134` | Replay detail title     | keep with reason | FileHeader owns workstation chrome. The existing 12px type size is retained; only variable call titles gain shrinking/truncation and a hover title. | None.            |
| `src/modules/WorkStation/CodeEditor/SessionReplay/FileSidebar.tsx:247`         | Replay tool names       | keep with reason | Existing SimulatorTreePanel renders the new labels, retaining navigation, selection, and row geometry.                                              | None.            |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

D1–D5 reviewed for the changed sites. No raw button/input, native button creation, or substitute clickable element is introduced. No action handler, focus contract, or keyboard behavior changes. Existing shared chrome is reused. Long-title behavior was inspected in light/dark component previews, including a mobile content column fitting a 375px viewport. Screenshots are in `docs/verification-2026-09-22/tool-call-titles/`.
