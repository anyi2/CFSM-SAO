export interface VirtualRowRange {
  startIndex: number;
  endIndex: number;
  topSpacer: number;
  bottomSpacer: number;
}

export function getVirtualGridColumnCount(
  containerWidth: number,
  minColumnWidth: number,
  gap: number,
): number {
  if (!Number.isFinite(containerWidth) || !Number.isFinite(minColumnWidth) || minColumnWidth <= 0) {
    return 1;
  }
  const safeGap = Number.isFinite(gap) && gap > 0 ? gap : 0;
  return Math.max(1, Math.floor((Math.max(0, containerWidth) + safeGap) / (minColumnWidth + safeGap)));
}

export function buildVirtualRowOffsets(
  rowCount: number,
  measuredHeights: Readonly<Record<number, number>>,
  estimatedHeight: number,
): number[] {
  const count = Math.max(0, Math.floor(rowCount));
  const estimate =
    Number.isFinite(estimatedHeight) && estimatedHeight > 0 ? estimatedHeight : 1;
  const offsets = new Array<number>(count + 1);
  offsets[0] = 0;
  for (let index = 0; index < count; index += 1) {
    const measured = measuredHeights[index];
    const height = Number.isFinite(measured) && measured > 0 ? measured : estimate;
    offsets[index + 1] = offsets[index]! + height;
  }
  return offsets;
}

export function calculateVirtualRowRange(
  offsets: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  overscanRows = 2,
): VirtualRowRange {
  const rowCount = Math.max(0, offsets.length - 1);
  if (rowCount === 0) {
    return { startIndex: 0, endIndex: 0, topSpacer: 0, bottomSpacer: 0 };
  }

  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const height = Number.isFinite(viewportHeight) ? Math.max(1, viewportHeight) : 1;
  const overscan = Number.isFinite(overscanRows) ? Math.max(0, Math.floor(overscanRows)) : 0;
  const bottom = top + height;

  let firstVisible = 0;
  while (firstVisible < rowCount && offsets[firstVisible + 1]! <= top) {
    firstVisible += 1;
  }

  let afterLastVisible = firstVisible;
  while (afterLastVisible < rowCount && offsets[afterLastVisible]! < bottom) {
    afterLastVisible += 1;
  }

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(rowCount, Math.max(firstVisible + 1, afterLastVisible) + overscan);
  return {
    startIndex,
    endIndex,
    topSpacer: offsets[startIndex] ?? 0,
    bottomSpacer: Math.max(0, (offsets[rowCount] ?? 0) - (offsets[endIndex] ?? 0)),
  };
}
