# Generated images: data privacy and isolation

This document accompanies the generated-image gallery. It separates required privacy behavior from safeguards verified in the implementation. It is not a claim that cross-user access and memory isolation have been fully audited or tested.

## Your data and other people's data

The required product behavior is reciprocal: your private conversations, images, files, and saved memories must remain available only to you and people you explicitly authorize. You must not be able to see another person's private content, and they must not be able to see yours. Membership in the same organization, use of the same model, or reuse of an agent definition must not itself grant access to private material.

An authorized shared conversation or workspace is an explicit exception. Its content is available to its permitted audience; sharing one conversation must not expose the owner's other conversations or personal memory. The UI should identify the audience before sharing or exporting content.

## How access isolation must work

Authorization must apply at the data boundary to the authenticated user and organization, the owning session, and the requested asset. It must cover listing, search, thumbnails, full-size images, transcript reads, downloads, and exports. Hiding another user's row in the UI is insufficient. A session ID, image offset, or URL is a reference, not proof of permission.

Caches and pending requests must respect those same access boundaries. Account or organization changes, logout, and revoked sharing must prevent old responses or cached previews from appearing in the new context. Separate browser windows or different selected sessions are not sufficient evidence of separate user identities.

On a local desktop, imported sessions and image files are accessible within the app's existing operating-system and filesystem permissions. The local image reader is not a multi-user authorization service. Do not describe two app accounts sharing one data directory as isolated merely because their session IDs differ.

## Personal memory and model context

Other users' private content must not enter your assistant's prompt, conversation summaries, saved memory, retrieval index, or personalized recommendations; the same restriction applies to your content entering theirs. This applies to image-derived captions and summaries as well as the original image.

Personal memory and deliberately shared workspace knowledge need distinct access scopes. Memory extraction and retrieval must enforce the source's audience and preserve its provenance. Using the same model or agent definition must not silently pool private memories. Permission to view a shared conversation must not automatically be treated as permission to copy its contents into permanent personal memory.

Revocation must prevent future retrieval from the revoked source. Derived memories and embeddings also need an explicit retention/deletion policy; removing a gallery thumbnail alone does not remove those derivatives. Already delivered messages or downloaded copies cannot be assumed to disappear retroactively.

These are required isolation guarantees, not a verified description of every existing memory path. Current session-memory commits use a session identity, while the learnings prompt path retrieves by `agent:<definition-id>`. That scope alone does not establish a user/organization authorization boundary. Cross-user memory exclusion needs its own access audit and tests before the app promises it as guaranteed behavior.

## What the gallery implementation verifies

- Each turn's gallery is collected from that turn's output events. Input attachments are excluded and duplicate output references within the turn are consolidated.
- Codex output references identify a session, transcript record, call, and image part. The reader resolves the source through the existing session resolver and checks the call/part identity. This protects source association; it does not replace access authorization.
- The frontend shares only in-flight transcript-image requests keyed by their full descriptor. Completed requests leave that map; mounted image components own their resolved sources and release owned object URLs on teardown. This is lifecycle cleanup, not a secure-erasure guarantee.
- Rendering or switching gallery thumbnails adds no memory-extraction call or new model request. This does not disable other existing session-memory processes, nor establish their isolation.
- Cloud turn export replaces local transcript references with portable image bytes. Exported images are content, not harmless pointers; the existing sharing/export authorization and audience controls remain responsible for them.

## Providers, sharing, and retention

A gallery may display an image served by a remote URL, which can make a network request to that host. Generation, explicit model reuse of an image, and existing memory extraction can involve configured providers. This display change does not establish provider retention, training-use, encryption, or deletion guarantees; those require the applicable provider and deployment configuration to be checked separately.

No new database or transcript retention policy is introduced by the gallery. Native transcript records remain the source of local generated images. Deleting a transcript, revoking access, or deleting remote content requires the corresponding source and sharing lifecycle to be handled; this PR does not implement those broader policies.

## Verification required before claiming full isolation

| Boundary                      | Required evidence                                                                                                                                   | Status for the gallery change                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Turn association              | Two image-generating rounds retain separate galleries; status footers do not hide the latest one                                                    | Covered by projection/renderer regressions and a local-session probe |
| Source integrity              | A changed call or image-part identity cannot resolve as the original output                                                                         | Covered by transcript identity checks and regression tests           |
| Cross-user access             | User A cannot list, fetch, preview, or export user B's private images by supplying B's identifiers                                                  | Not verified by this PR                                              |
| Personal memory               | A private source belonging to B cannot enter A's prompt, summaries, saved memory, or retrieval results, including through a shared agent definition | Not verified by this PR                                              |
| Explicit sharing              | Only the authorized shared scope is accessible; unrelated personal content remains excluded                                                         | Not verified by this PR                                              |
| Account switch and revocation | Warm caches, pending reads, reconnects, and restarts cannot reuse content after access changes                                                      | Not verified end to end by this PR                                   |
| Derived retention             | Memory and embedding deletion/revocation follows source provenance and documented retention rules                                                   | Not implemented or verified by this PR                               |

## Source references

- [Local session-image reader](../src-tauri/src/orgtrack/history_commands/provider_commands.rs)
- [Codex output references and identity validation](../src-tauri/crates/orgtrack-core/src/sources/codex/app/transcript/output_images.rs)
- [Frontend in-flight request ownership](../src/api/tauri/externalHistory/sources/codexApp/images.ts)
- [Thumbnail source lifecycle](../src/engines/ChatPanel/ChatImageThumbnail/index.tsx)
- [Turn-owned image collection](../src/engines/ChatPanel/ChatHistory/hooks/turnOutputImages.ts)
- [Session-memory commit boundary](../src-tauri/crates/agent-core/src/core/session/turn/session_memory_commit.rs)
- [Learnings prompt scope](../src-tauri/crates/agent-core/src/core/session/prompt/sections/rules_and_memory.rs)
- [Learnings query scope](../src-tauri/crates/agent-core/src/specialization/memory/learnings/crud.rs)
