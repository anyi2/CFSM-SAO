import { describe, expect, it } from "vitest";
import { makeNodeSlug } from "@/utils/nodeSlug";

describe("makeNodeSlug", () => {
  it("normalizes host names into readable path segments", () => {
    expect(makeNodeSlug(" Tokyo Node ")).toBe("tokyo-node");
    expect(makeNodeSlug("HK-01")).toBe("hk-01");
  });

  it("preserves Chinese host names", () => {
    expect(makeNodeSlug("德国 法兰克福")).toBe("德国-法兰克福");
  });

  it("normalizes full-width characters and unsafe path separators", () => {
    expect(makeNodeSlug("Ｔｏｋｙｏ／Node")).toBe("tokyo-node");
  });

  it("returns an empty slug for an empty host name", () => {
    expect(makeNodeSlug("   ")).toBe("");
  });
});
