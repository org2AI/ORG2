# SharedSessionFiles UI audit

| Line                                                                            | Element            | Verdict          | Reason                                                                           | Suggested change |
| ------------------------------------------------------------------------------- | ------------------ | ---------------- | -------------------------------------------------------------------------------- | ---------------- |
| `src/features/Org2Cloud/SharedSessionFileViewer.tsx:158`                        | Modal              | keep with reason | Existing ModalSystem owns focus trap, Escape and themed surface                  | None             |
| `src/features/Org2Cloud/SharedSessionFileViewer.tsx:201`                        | Download           | keep with reason | Existing Button loading state; direct Downloads save and localized toast         | None             |
| `src/features/Org2Cloud/SharedSessionFileViewer.tsx:190`                        | Text preview       | keep with reason | Escaped preformatted text, semantic theme and spacing tokens                     | None             |
| `src/features/Org2Cloud/SharedSessionFileViewer.tsx:166`                        | Error/loading      | keep with reason | Localized copy and alert/status semantics                                        | None             |
| `src/features/Org2Cloud/SharedSessionFileViewer.tsx:176`                        | PDF/image preview  | keep with reason | Bounded standard height tokens; title/alt names; sandboxed PDF                   | None             |
| `src/features/Org2Cloud/SharedSessionFileLink.tsx:17`                           | Shared file anchor | keep with reason | Native keyboard link with existing reference tokens and lazy shared viewer       | None             |
| `src/components/MarkDown/MarkDownImpl.tsx:206`                                  | File navigation    | keep with reason | Existing presentation, shared context changes resolution only                    | None             |
| `src/components/MarkDown/MarkdownLocalImage.tsx:110`                            | Shared image entry | keep with reason | Accessible file action avoids probing another user's local path                  | None             |
| `src/engines/ChatPanel/ChatHistory/components/UserMessagePills.tsx:114`         | Shared file pill   | keep with reason | Reuses shared anchor and existing pill label                                     | None             |
| `src/engines/ChatPanel/ChatHistory/components/TurnMetadataFooter/index.tsx:173` | Edits action       | keep with reason | Existing list/button layout routes selected file through context                 | None             |
| `src/engines/ChatPanel/blocks/CodeBlock/index.tsx:155`                          | Code file action   | keep with reason | Existing action and theme unchanged; disables inappropriate receiver-local hover | None             |
| `src/engines/ChatPanel/blocks/ToolCallBlock/ToolResultActions.tsx:21`           | Tool file action   | keep with reason | Existing button routes through the common shared resolver                        | None             |
| `src/modules/MainApp/TeamInbox/components/CommentMentionDetail.tsx:186`         | Inbox file scope   | keep with reason | Existing text renderers reused under the source session context                  | None             |

Verdict totals: **0 fix**, **13 keep with reason**, **0 abstract**.

Scope includes the shared provider and EventFileHoverPreview's shared-context guard, neither of which adds visual styling. No unrelated component sweep identified. Native macOS light-theme text/user-file previews, denied state and second-boot previews were checked in the native run; screenshots were removed at the author’s request. Dark/narrow/loading/PDF checks remain uncovered. JSDOM tests additionally establish lifecycle and safe text behavior.

Review follow-up: the file provider uses persisted remote-replay provenance, independently of comment admission and authentication. This changes navigation ownership only; the existing UI verdicts remain applicable.
