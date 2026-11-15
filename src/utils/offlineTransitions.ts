/** Returns only true -> false transitions; unknown and first-seen states never alert. */
export function findNewlyOfflineUuids(
  previous: ReadonlyMap<string, boolean | null>,
  current: ReadonlyMap<string, boolean | null>,
): string[] {
  const newlyOffline: string[] = [];
  for (const [uuid, online] of current) {
    if (online === false && previous.get(uuid) === true) newlyOffline.push(uuid);
  }
  return newlyOffline;
}
