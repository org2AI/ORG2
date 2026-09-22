interface NamedProfile {
  id: string;
  label: string;
}

/** Distinguish equal package titles without exposing purchase or identity ids.
 * Sort by stable ids so a catalogue refresh cannot swap the displayed numbers. */
export function marketProfileLabel(
  profile: NamedProfile,
  profiles: readonly NamedProfile[]
): string {
  const matches = [
    ...new Set(
      profiles
        .filter((item) => item.label === profile.label)
        .map((item) => item.id)
    ),
  ].sort();
  if (matches.length < 2) return profile.label;
  const index = matches.indexOf(profile.id);
  if (index < 0) return profile.label;
  return `${profile.label} · ${index + 1}/${matches.length}`;
}
