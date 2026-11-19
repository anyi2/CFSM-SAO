import { describe, expect, it } from "vitest";
import { filterVisibleNodes } from "@/utils/nodeVisibility";

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
});
