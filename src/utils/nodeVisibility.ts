import type { NodeInfo } from "@/types/cfsm";

/**
 * A backend-hidden node stays out of every theme-facing view, regardless of
 * whether the current visitor is authenticated. CFSM retains the authoritative
 * node state; this helper only controls what the theme renders.
 */
export function filterVisibleNodes<T extends Pick<NodeInfo, "uuid" | "hidden">>(
  nodes: readonly T[],
  themeHiddenUuids: ReadonlySet<string>,
): T[] {
  return nodes.filter((node) => !node.hidden && !themeHiddenUuids.has(node.uuid));
}
