/** Convert a configured host name into its stable, readable detail-route slug. */
export function makeNodeSlug(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[/?#%\\]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
