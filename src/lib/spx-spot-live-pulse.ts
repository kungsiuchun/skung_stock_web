export interface SpxSpotLivePulseInput {
  price: number | null | undefined;
  timeEt: string | null | undefined;
  resolution: "1m" | "15m-fallback" | "15m-canonical";
}

/**
 * A stable React key: unchanged source data must not replay the live pulse,
 * while a new price candle or canonical snapshot intentionally remounts it.
 */
export const getSpxSpotLivePulseKey = ({ price, timeEt, resolution }: SpxSpotLivePulseInput) => {
  if (typeof price !== "number" || !Number.isFinite(price) || !timeEt) return null;
  return `${resolution}:${timeEt}:${price.toFixed(4)}`;
};
