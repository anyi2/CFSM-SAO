import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { useVisibleNodes } from "@/hooks/useVisibleNodes";
import { useNodeOnlineSummaries } from "@/hooks/useNode";
import { findNewlyOfflineUuids } from "@/utils/offlineTransitions";

const STORAGE_KEY = "cfsm-sao:offline-notifications";

function readEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Browser notifications work only while this theme page remains open and running.
 * This is not a server-side monitor and cannot alert after the browser closes.
 */
export function OfflineNotificationToggle() {
  const [enabled, setEnabled] = useState(readEnabled);
  const [message, setMessage] = useState("");
  const visibleNodes = useVisibleNodes();
  const onlineSummaries = useNodeOnlineSummaries();
  const previous = useRef<Map<string, boolean | null> | null>(null);

  const current = useMemo(() => {
    const onlineByUuid = new Map(onlineSummaries.map((item) => [item.uuid, item.online]));
    return new Map(visibleNodes.map((node) => [node.uuid, onlineByUuid.get(node.uuid) ?? null]));
  }, [onlineSummaries, visibleNodes]);

  const names = useMemo(
    () => new Map(visibleNodes.map((node) => [node.uuid, node.name?.trim() || node.uuid])),
    [visibleNodes],
  );

  useEffect(() => {
    const before = previous.current;
    previous.current = current;
    if (!enabled || !before || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const uuid of findNewlyOfflineUuids(before, current)) {
      try {
        new Notification("服务器离线", {
          body: (names.get(uuid) ?? uuid) + " 已离线，请检查节点连接。",
          tag: "cfsm-offline-" + uuid,
        });
      } catch {
        // Browser policy or the operating system may reject notification delivery.
      }
    }
  }, [current, enabled, names]);

  const toggle = async () => {
    if (enabled) {
      setEnabled(false);
      setMessage("离线通知已关闭");
      try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
      return;
    }
    if (typeof Notification === "undefined") {
      setMessage("当前浏览器不支持通知");
      return;
    }
    try {
      const permission = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage(permission === "denied" ? "通知权限被浏览器拒绝" : "尚未授予通知权限");
        return;
      }
      setEnabled(true);
      setMessage("离线通知已开启（页面保持打开时生效）");
      try { window.localStorage.setItem(STORAGE_KEY, "1"); } catch {}
    } catch {
      setMessage("无法启用浏览器通知");
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-pressed={enabled}
        className="inline-flex items-center gap-1.5 rounded-lg border border-(--hairline) bg-(--bg-card) px-3 py-2 text-[12px] font-medium text-(--text-secondary) transition-colors hover:text-(--text-primary)"
        title="仅在监控页面保持打开时有效"
      >
        {enabled ? <Bell size={14} /> : <BellOff size={14} />}
        {enabled ? "离线通知已开" : "离线通知"}
      </button>
      {message && <span className="sr-only" role="status">{message}</span>}
    </span>
  );
}
