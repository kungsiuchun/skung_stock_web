export interface SpxGexTooltipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SpxGexTooltipPosition {
  left: number;
  top: number;
  placement: "top" | "bottom";
  width: number;
  maxHeight: number;
}

export const getSpxGexTooltipPosition = (input: {
  anchor: SpxGexTooltipRect;
  viewport: { width: number; height: number };
  tooltip: { width: number; estimatedHeight: number };
  margin?: number;
  gap?: number;
}): SpxGexTooltipPosition => {
  const margin = input.margin ?? 8;
  const gap = input.gap ?? 10;
  const width = Math.max(1, Math.min(input.tooltip.width, input.viewport.width - margin * 2));
  const maxHeight = Math.max(120, input.viewport.height - margin * 2);
  const height = Math.min(input.tooltip.estimatedHeight, maxHeight);
  const centeredLeft = input.anchor.left + input.anchor.width / 2 - width / 2;
  const left = Math.max(margin, Math.min(input.viewport.width - width - margin, centeredLeft));
  const fitsAbove = input.anchor.top - gap - height >= margin;
  const placement = fitsAbove ? "top" : "bottom";
  const requestedTop = fitsAbove
    ? input.anchor.top - gap - height
    : input.anchor.top + input.anchor.height + gap;
  const top = Math.max(margin, Math.min(input.viewport.height - height - margin, requestedTop));
  return { left, top, placement, width, maxHeight };
};
