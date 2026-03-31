"use client";

import { useEffect, useState, useCallback } from "react";

/** Check if B3 market is open: Mon-Fri, 10:00-17:00 America/Sao_Paulo */
function checkMarketOpen(): boolean {
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  });
  const parts = fmt.formatToParts(new Date());
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);

  // Weekend check (pt-BR short weekdays: sáb, dom)
  const lower = weekday.toLowerCase();
  if (lower.startsWith("sáb") || lower.startsWith("dom")) return false;

  const totalMinutes = hour * 60 + minute;
  return totalMinutes >= 600 && totalMinutes < 1020; // 10:00 - 17:00
}

export function useAutoRefresh(callback: () => void, intervalMs = 300_000) {
  const [isMarketOpen, setIsMarketOpen] = useState(checkMarketOpen);

  const stableCallback = useCallback(callback, [callback]);

  useEffect(() => {
    const tick = () => {
      const open = checkMarketOpen();
      setIsMarketOpen(open);
      if (open) stableCallback();
    };

    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [stableCallback, intervalMs]);

  return { isMarketOpen };
}
