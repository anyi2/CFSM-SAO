import { describe, expect, it } from "vitest";
import { findNewlyOfflineUuids } from "@/utils/offlineTransitions";

describe("findNewlyOfflineUuids", () => {
  it("only reports true to false changes", () => {
    const previous = new Map<string, boolean | null>([
      ["a", true], ["b", false], ["c", null], ["d", true],
    ]);
    const current = new Map<string, boolean | null>([
      ["a", false], ["b", false], ["c", false], ["d", null], ["e", false],
    ]);
    expect(findNewlyOfflineUuids(previous, current)).toEqual(["a"]);
  });

  it("does not treat a first snapshot as an outage", () => {
    expect(findNewlyOfflineUuids(new Map(), new Map([["node", false]]))).toEqual([]);
  });
});
