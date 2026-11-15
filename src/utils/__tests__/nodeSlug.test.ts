import { describe, expect, it } from "vitest";
import { findNodesBySlug, makeNodeSlug } from "@/utils/nodeSlug";

describe("makeNodeSlug", () => {
  it("preserves the configured host name", () => {
    expect(makeNodeSlug(" Tokyo Node ")).toBe("Tokyo Node");
    expect(makeNodeSlug("HK-01")).toBe("HK-01");
  });

  it("preserves Chinese host names", () => {
    expect(makeNodeSlug("德国 法兰克福")).toBe("德国 法兰克福");
  });

  it("does not collapse distinct names into the same slug", () => {
    expect(makeNodeSlug("HK Node")).not.toBe(makeNodeSlug("HK-Node"));
    expect(makeNodeSlug("Tokyo")).not.toBe(makeNodeSlug("tokyo"));
  });

  it("returns an empty value for an empty host name", () => {
    expect(makeNodeSlug("   ")).toBe("");
  });

  it("resolves a hostname only when it matches one node", () => {
    const nodes = [
      { uuid: "node-a", name: "Tokyo" },
      { uuid: "node-b", name: "London" },
    ];
    expect(findNodesBySlug(nodes, "Tokyo").map((node) => node.uuid)).toEqual(["node-a"]);
  });

  it("returns all duplicate hostname matches instead of selecting the first", () => {
    const nodes = [
      { uuid: "node-a", name: "Tokyo" },
      { uuid: "node-b", name: "Tokyo " },
      { uuid: "node-c", name: "London" },
    ];
    expect(findNodesBySlug(nodes, "Tokyo").map((node) => node.uuid)).toEqual(["node-a", "node-b"]);
  });

  it("uses UUIDs when a configured hostname contains only whitespace", () => {
    expect(findNodesBySlug([{ uuid: "node-a", name: "   " }], "node-a")).toHaveLength(1);
  });

  it("uses UUIDs for nodes without a configured name", () => {
    expect(findNodesBySlug([{ uuid: "node-a", name: "" }], "node-a")).toHaveLength(1);
  });
});
