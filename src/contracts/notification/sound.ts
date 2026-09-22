/**
 * Notification sound vocabulary.
 *
 * `config/notificationSounds` owns the tone synthesis; the preset union and
 * its backing tuple live here because `types/ui/notification` (and the
 * settings surfaces above it) name them.
 */

export const NOTIFICATION_SOUND_PRESETS = [
  "classic",
  "gentle",
  "ascending",
  "bell",
] as const;

export type NotificationSoundPreset =
  (typeof NOTIFICATION_SOUND_PRESETS)[number];
