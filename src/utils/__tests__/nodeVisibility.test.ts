import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterVisibleNodes } from "@/utils/nodeVisibility";

const nodeGridSource = readFileSync(
  new URL("../../components/node/NodeGrid.tsx", import.meta.url),
  "utf8",
);
const instanceSwitcherSource = readFileSync(
  new URL("../../components/instance/InstanceSwitcher.tsx", import.meta.url),
  "utf8",
);
const visibleNodesHookSource = readFileSync(
  new URL("../../hooks/useVisibleNodes.ts", import.meta.url),
  "utf8",
);
const useNodeHookSource = readFileSync(
  new URL("../../hooks/useNode.ts", import.meta.url),
  "utf8",
);
const instancePageSource = readFileSync(
  new URL("../../pages/Instance.tsx", import.meta.url),
  "utf8",
);

describe("filterVisibleNodes", () => {
  it("hides backend-hidden nodes for every viewer while retaining visible online and offline nodes", () => {
    const nodes = [
      { uuid: "online-visible", hidden: false, online: true },
      { uuid: "online-hidden", hidden: true, online: true },
      { uuid: "offline-visible", hidden: false, online: false },
      { uuid: "offline-hidden", hidden: true, online: false },
      { uuid: "theme-hidden", hidden: false, online: true },
    ];

    const visible = filterVisibleNodes(nodes, new Set(["theme-hidden"]));

    expect(visible.map((node) => node.uuid)).toEqual([
      "online-visible",
      "offline-visible",
    ]);
  });

  it("uses the same visibility rule for home cards, cluster totals, and node switching", () => {
    expect(nodeGridSource).toContain("filterVisibleNodes(nodes, hiddenUuids)");
    expect(nodeGridSource).toContain("filterVisibleNodes(allMeta, hiddenUuids)");
    expect(instanceSwitcherSource).toContain("filterVisibleNodes(allMeta, hiddenUuids)");
    expect(nodeGridSource).not.toContain("me?.logged_in === true || !node.hidden");
    expect(instanceSwitcherSource).not.toContain("me?.logged_in === true || !node.hidden");
  });

  it("uses the same rule for shared node lists and direct detail URLs", () => {
    expect(visibleNodesHookSource).toContain("filterVisibleNodes(allNodes, hiddenUuids)");
    expect(useNodeHookSource).toContain("filterVisibleNodes(allNodes, hiddenUuids)");
    expect(instancePageSource).toContain("const visibleNodes = useVisibleNodes()");
    expect(instancePageSource).toContain("const uuidIsVisible = uuid ? visibleNodes.some");
  });
});
