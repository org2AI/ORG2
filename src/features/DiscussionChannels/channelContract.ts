/**
 * Scope-neutral discussion-channel contract shared by the local and cloud
 * planes.
 *
 * The declarations moved down to `@src/contracts/channels/channelName` so the
 * local store atoms can name them without importing `features/`. This module
 * stays as the DiscussionChannels-facing facade.
 */

export * from "@src/contracts/channels/channelName";
