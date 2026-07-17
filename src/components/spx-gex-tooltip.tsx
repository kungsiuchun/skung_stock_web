import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getSpxGexTooltipPosition, type SpxGexTooltipRect } from "@/lib/spx-gex-tooltip";

interface SpxGexTooltipProps {
  id: string;
  anchor: SpxGexTooltipRect;
  children: ReactNode;
  width?: number;
  estimatedHeight?: number;
  surface: "pressure" | "board";
  interactive?: boolean;
}

export function SpxGexTooltip({
  id,
  anchor,
  children,
  width = 320,
  estimatedHeight = 150,
  surface,
  interactive = false,
}: SpxGexTooltipProps) {
  const [viewport, setViewport] = useState({ width: 1440, height: 900 });

  useEffect(() => {
    const sync = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  if (typeof document === "undefined") return null;
  const position = getSpxGexTooltipPosition({
    anchor,
    viewport,
    tooltip: { width, estimatedHeight },
  });

  return createPortal(
    <div
      id={id}
      role="tooltip"
      className={`${interactive ? "pointer-events-auto" : "pointer-events-none"} fixed z-[1200] hidden overscroll-contain overflow-y-auto border border-cyan-300/70 bg-[#030b12]/95 p-3 font-mono text-[11px] leading-4 text-zinc-300 shadow-[0_16px_40px_rgba(0,0,0,.55)] backdrop-blur tabular-nums md:block`}
      style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
      data-spx-gex-tooltip-surface={surface}
      data-spx-gex-pressure-tooltip={surface === "pressure" ? "desktop" : undefined}
      data-gex-audit-tooltip={surface === "board" ? "desktop" : undefined}
      data-tooltip-placement={position.placement}
    >
      {children}
    </div>,
    document.body,
  );
}

export function SpxGexInlineTooltip({
  children,
  surface,
}: {
  children: ReactNode;
  surface: "pressure" | "board";
}) {
  return (
    <div
      className="border-t border-[#123142] bg-[#06111a] px-3 py-3 font-mono text-[11px] leading-4 text-zinc-300 tabular-nums md:hidden"
      aria-live="polite"
      data-spx-gex-tooltip-surface={surface}
      data-spx-gex-pressure-tooltip={surface === "pressure" ? "mobile" : undefined}
      data-gex-audit-tooltip={surface === "board" ? "mobile" : undefined}
    >
      {children}
    </div>
  );
}

export const SpxGexTooltipSection = ({ label, children }: { label?: string; children: ReactNode }) => (
  <div className="border-t border-white/10 pt-2 first:border-t-0 first:pt-0">
    {label && <div className="mb-1 font-black uppercase tracking-[0.12em] text-cyan-300/70">{label}</div>}
    <div className="space-y-1 break-words">{children}</div>
  </div>
);
