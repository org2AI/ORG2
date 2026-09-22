/**
 * Queued canonical-conversation contract.
 *
 * The declarations moved down to `@src/contracts/conversation/queuedConversation`
 * so `store/ui` (the durable queue's atoms and repository) can name them
 * without importing `engines/`. This module stays as the SessionCore-facing
 * facade; the error classes keep a single module identity, so `instanceof`
 * is unaffected.
 */

export * from "@src/contracts/conversation/queuedConversation";
