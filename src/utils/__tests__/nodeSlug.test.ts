import { describe, expect, it } from "vitest";
import { makeNodeSlug } from "@/utils/nodeSlug";

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
});
