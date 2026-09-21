/**
 * Canonical-conversation shapes.
 *
 * The declarations moved down to `@src/contracts/conversation` so `store/`
 * can name them without importing `engines/`. This module stays as the
 * SessionCore-facing facade.
 */

export * from "@src/contracts/conversation/conversationTypes";
