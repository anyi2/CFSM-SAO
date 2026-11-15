import { describe, expect, it } from "vitest";
import {
  buildVirtualRowOffsets,
  calculateVirtualRowRange,
  getVirtualGridColumnCount,
} from "@/utils/virtualGrid";

describe("virtual grid layout helpers", () => {
  it("computes responsive columns without allowing cards below their minimum width", () => {
    expect(getVirtualGridColumnCount(1430, 340, 16)).toBe(4);
    expect(getVirtualGridColumnCount(390, 340, 12)).toBe(1);
    expect(getVirtualGridColumnCount(0, 340, 12)).toBe(1);
  });

  it("uses measured row heights and estimated heights for unvisited rows", () => {
    expect(buildVirtualRowOffsets(4, { 0: 320, 2: 380 }, 300)).toEqual([
      0, 320, 620, 1000, 1300,
    ]);
  });

  it("renders only visible rows plus overscan and preserves spacer heights", () => {
    const offsets = buildVirtualRowOffsets(100, { 0: 320, 1: 360 }, 300);
    const range = calculateVirtualRowRange(offsets, 900, 600, 2);
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBeLessThan(10);
    expect(range.topSpacer).toBe(0);
    expect(range.bottomSpacer).toBeGreaterThan(20_000);
  });

  it("jumps to the final rows without mounting the full collection", () => {
    const offsets = buildVirtualRowOffsets(1000, {}, 320);
    const range = calculateVirtualRowRange(offsets, offsets[1000]! - 900, 800, 3);
    expect(range.startIndex).toBeGreaterThan(980);
    expect(range.endIndex).toBe(1000);
    expect(range.endIndex - range.startIndex).toBeLessThan(10);
  });

  it("handles empty grids", () => {
    expect(calculateVirtualRowRange([0], 0, 800)).toEqual({
      startIndex: 0, endIndex: 0, topSpacer: 0, bottomSpacer: 0,
    });
  });
});
