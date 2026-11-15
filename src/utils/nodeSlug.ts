/** Keep the configured host name intact; encode it as one URL path segment at navigation time. */
export function makeNodeSlug(name: string): string {
  return name.trim();
}
