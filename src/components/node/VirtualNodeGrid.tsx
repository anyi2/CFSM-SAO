import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CompactNodeCard } from "./CompactNodeCard";
import { MiniNodeCard } from "./MiniNodeCard";
import { NodeCard } from "./NodeCard";
import type { NodeViewMode } from "@/utils/themeSettings";
import {
  buildVirtualRowOffsets,
  calculateVirtualRowRange,
  getVirtualGridColumnCount,
} from "@/utils/virtualGrid";

type GridMode = Exclude<NodeViewMode, "list">;

interface VirtualNodeGridProps {
  uuids: string[];
  mode: GridMode;
  minColumnWidth: number;
  className: string;
  gridStyle?: CSSProperties;
  cardsReady: boolean;
}

interface ViewportState {
  width: number;
  windowWidth: number;
  height: number;
  scrollOffset: number;
}

const VIRTUALIZE_THRESHOLD = 80;
const OVERSCAN_ROWS = 3;
const ESTIMATED_CARD_HEIGHT: Record<GridMode, number> = {
  large: 440,
  compact: 300,
  mini: 142,
};

function responsiveGap(mode: GridMode, windowWidth: number): number {
  if (windowWidth >= 1280) {
    return mode === "large" ? 20 : mode === "compact" ? 16 : 14;
  }
  return mode === "large" ? 16 : 12;
}

function renderNodeCard(uuid: string, mode: GridMode) {
  return (
    <div key={uuid} data-node-uuid={uuid} className="min-w-0">
      {mode === "mini" ? (
        <MiniNodeCard uuid={uuid} />
      ) : mode === "compact" ? (
        <CompactNodeCard uuid={uuid} />
      ) : (
        <NodeCard uuid={uuid} />
      )}
    </div>
  );
}

export function VirtualNodeGrid({
  uuids,
  mode,
  minColumnWidth,
  className,
  gridStyle,
  cardsReady,
}: VirtualNodeGridProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<ViewportState>({
    width: 0,
    windowWidth: 0,
    height: 0,
    scrollOffset: 0,
  });
  const [rowHeights, setRowHeights] = useState<Record<number, number>>({});

  const measureViewport = useCallback(() => {
    const element = containerRef.current;
    if (!element || typeof window === "undefined") return;
    const rect = element.getBoundingClientRect();
    const next: ViewportState = {
      width: rect.width,
      windowWidth: window.innerWidth,
      height: window.innerHeight,
      // The page itself scrolls; convert viewport coordinates into this grid's local scroll offset.
      scrollOffset: Math.max(0, -rect.top),
    };
    setViewport((previous) =>
      previous.width === next.width &&
      previous.windowWidth === next.windowWidth &&
      previous.height === next.height &&
      Math.abs(previous.scrollOffset - next.scrollOffset) < 1
        ? previous
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    measureViewport();
    const element = containerRef.current;
    if (!element) return;

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measureViewport);
    observer?.observe(element);
    window.addEventListener("scroll", measureViewport, { passive: true });
    window.addEventListener("resize", measureViewport);
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", measureViewport);
      window.removeEventListener("resize", measureViewport);
    };
  }, [measureViewport]);

  const gap = responsiveGap(mode, viewport.windowWidth);
  const columns = useMemo(() => {
    const fitted = getVirtualGridColumnCount(
      viewport.width || minColumnWidth,
      minColumnWidth,
      gap,
    );
    if (mode !== "mini") return fitted;

    // Keep the mini-card breakpoint contract from home.css (5 / 4 / 3 / 2 / 1 columns).
    const width = viewport.windowWidth || 1440;
    const cssCap =
      width <= 580 ? 1 :
      width <= 860 ? 2 :
      width <= 1150 ? 3 :
      width <= 1440 ? 4 : 5;
    return Math.max(1, Math.min(fitted, cssCap));
  }, [viewport.width, viewport.windowWidth, minColumnWidth, gap, mode]);

  useEffect(() => {
    setRowHeights({});
  }, [columns, uuids]);

  const virtualized = uuids.length >= VIRTUALIZE_THRESHOLD;
  const rowCount = Math.ceil(uuids.length / columns);
  const estimatedRowHeight = ESTIMATED_CARD_HEIGHT[mode] + gap;

  const offsets = useMemo(
    () => buildVirtualRowOffsets(rowCount, rowHeights, estimatedRowHeight),
    [rowCount, rowHeights, estimatedRowHeight],
  );
  const range = useMemo(
    () =>
      calculateVirtualRowRange(
        offsets,
        viewport.scrollOffset,
        viewport.height || 900,
        OVERSCAN_ROWS,
      ),
    [offsets, viewport.scrollOffset, viewport.height],
  );

  useLayoutEffect(() => {
    if (!virtualized || !cardsReady) return;
    const container = containerRef.current;
    if (!container) return;

    const updateHeights = (elements: HTMLElement[]) => {
      const measurements = elements.map((element) => ({
        index: Number(element.dataset.virtualRow),
        height: element.getBoundingClientRect().height,
      }));
      setRowHeights((previous) => {
        let changed = false;
        const next = { ...previous };
        for (const measurement of measurements) {
          if (
            Number.isInteger(measurement.index) &&
            measurement.height > 0 &&
            Math.abs((next[measurement.index] ?? 0) - measurement.height) > 1
          ) {
            next[measurement.index] = measurement.height;
            changed = true;
          }
        }
        return changed ? next : previous;
      });
    };

    const elements = Array.from(
      container.querySelectorAll<HTMLElement>("[data-virtual-row]"),
    );
    updateHeights(elements);

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      updateHeights(entries.map((entry) => entry.target as HTMLElement));
    });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [virtualized, cardsReady, range.startIndex, range.endIndex, columns, gap, uuids.length]);

  if (!cardsReady) {
    return (
      <div
        ref={containerRef}
        className={className}
        style={{ ...gridStyle, display: "flex", flexDirection: "column", gap: 0 }}
      />
    );
  }

  if (!virtualized) {
    return (
      <div ref={containerRef} className={className} style={gridStyle}>
        {uuids.map((uuid) => renderNodeCard(uuid, mode))}
      </div>
    );
  }

  const rowStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    columnGap: gap,
    paddingBottom: gap,
    flex: "0 0 auto",
  };

  return (
    <div
      ref={containerRef}
      className={className}
      data-virtualized="true"
      data-total-cards={uuids.length}
      style={{ ...gridStyle, display: "flex", flexDirection: "column", gap: 0, width: "100%" }}
    >
      <div aria-hidden="true" style={{ height: range.topSpacer, flex: "0 0 auto" }} />
      {Array.from({ length: range.endIndex - range.startIndex }, (_, offset) => {
        const rowIndex = range.startIndex + offset;
        const rowUuids = uuids.slice(rowIndex * columns, (rowIndex + 1) * columns);
        return (
          <div key={rowIndex} data-virtual-row={rowIndex} style={rowStyle}>
            {rowUuids.map((uuid) => renderNodeCard(uuid, mode))}
          </div>
        );
      })}
      <div aria-hidden="true" style={{ height: range.bottomSpacer, flex: "0 0 auto" }} />
    </div>
  );
}
