/** Keep the configured host name intact; encode it as one URL path segment at navigation time. */
export function makeNodeSlug(name: string): string {
  return name.trim();
}

/** Return every node matching the public host-name slug; callers must require exactly one match. */
export function findNodesBySlug<T extends { uuid: string; name?: string | null }>(
  nodes: readonly T[],
  slug: string,
): T[] {
  return nodes.filter((node) => makeNodeSlug(node.name || node.uuid) === slug);
}
