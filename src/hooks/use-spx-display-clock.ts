import { useEffect, useState } from "react";
import { getSpxDisplayExpiryDelay, type SpxDisplaySource } from "@/lib/spx-display-freshness";

export function useSpxDisplayClock(source: SpxDisplaySource | null | undefined) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNowMs(Date.now());
    const delay = getSpxDisplayExpiryDelay(source, Date.now());
    const timer = delay === null ? null : window.setTimeout(update, delay);
    document.addEventListener("visibilitychange", update);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [source, nowMs]);
  return Math.max(nowMs, Date.now());
}
