import { useMemo } from "react";
import { useAllNodeMeta } from "@/hooks/useNode";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { collectMatchingNodeUuids } from "@/utils/nodeIdentity";
import type { NodeInfo } from "@/types/cfsm";
import { filterVisibleNodes } from "@/utils/nodeVisibility";

let cachedMeta: NodeInfo[] | null = null;
let cachedHidden: string[] | null = null;
let cachedResult: Set<string> | null = null;

// 同帧内多个消费者(首页网格/overview 拉取/资产页/流量页)共享一次名称匹配解析。
function resolveHiddenNodeUuids(allMeta: NodeInfo[], hiddenNodes: string[]): Set<string> {
  if (cachedResult && cachedMeta === allMeta && cachedHidden === hiddenNodes) {
    return cachedResult;
  }
  cachedMeta = allMeta;
  cachedHidden = hiddenNodes;
  cachedResult = collectMatchingNodeUuids(allMeta, hiddenNodes);
  return cachedResult;
}

/** 主题级隐藏列表 → uuid 集合。名称匹配需要完整 meta。 */
export function useHiddenNodeUuids(): Set<string> {
  const allMeta = useAllNodeMeta();
  const themeSettings = useThemeSettings();
  const hiddenNodes = themeSettings.hiddenNodes;
  return useMemo(() => resolveHiddenNodeUuids(allMeta, hiddenNodes), [allMeta, hiddenNodes]);
}

/**
 * 全站统一的节点可见性口径：后端 hidden 和主题级隐藏对所有访客（包括已登录用户）均不渲染。
 * 后端仍保留节点真实状态；这里仅过滤主题前端的展示数据。
 */
export function useVisibleNodes(): NodeInfo[] {
  const allNodes = useAllNodeMeta();
  const hiddenUuids = useHiddenNodeUuids();
  return useMemo(
    () => filterVisibleNodes(allNodes, hiddenUuids),
    [allNodes, hiddenUuids],
  );
}
