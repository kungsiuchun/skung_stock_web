// Deterministic UI fixtures, never used by the application or live-data checks.
const chartData = Array.from({ length: 45 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 7, 10 + index)).toISOString().slice(0, 10);
  const price = +(190 + index * 0.4 + Math.sin(index * 0.7) * 5).toFixed(2);
  return { date, date_iso: date, price, open: price - Math.cos(index) * 2, high: price + 3, low: price - 3, volume: 20_000_000 + index * 200_000 };
});
const result = (symbol) => ({
  symbol, price: 212.84, change: '+1.24%', algoRating: 67, marketSentiment: null,
  quantStrategySchemaVersion: 'v3', strategyPoints: {}, chartData: chartData.map(bar => ({...bar})), quantStrategies: [], recommendedTrade: null,
  decision: { status: 'unavailable', reason: 'UAT fixture: no AI trading decision.' },
  dashboardNarrative: { status: 'unavailable', reason: 'UAT fixture: no generated narrative.' },
  news: [
    { title: `${symbol} research headline — UAT fixture`, publisher: 'Fixture publisher', publish_time: '2026-09-23T20:00:00Z', link: 'https://example.com/research-fixture' },
    { title: `${symbol} undated headline — UAT fixture`, publisher: 'Fixture publisher', publish_time: '', link: 'https://example.com/undated-fixture' },
  ],
  optionsFlow: { totalCallOI: 12000, totalPutOI: 8000, ratio: 1.5, topStrikes: [{ strike: 210, callOI: 5000, putOI: 3000 }, { strike: 215, callOI: 7000, putOI: 5000 }], expirationDate: '2026-09-25' },
});
const cache = { status: 'hit', sourceAsOf: null, cachedAt: '2026-09-23T20:00:00Z', expiresAt: '2026-09-23T20:01:00Z', ageSeconds: 0, ttlMs: 60000, ageRatio: 0, guard: 'fresh' };
const snapshot = (symbol) => ({ data: { data: result(symbol), technicalData: { rsi_14: 54, rsi_status: 'neutral', ma_alignment: 'Fixture alignment', position_percent: 65 }, valuationData: { symbol, pe_ratio: '25.4', eps: '8.38', peg_ratio: '1.8', analyst_target_price: '220' }, vixData: { value: 18.5, change_pct: -1.2, history: [20, 19, 18, 19, 18.5] } }, cache });
const candles = (symbol, interval) => ({ data: {
  schemaVersion: 'v1', symbol, interval, source: 'Yahoo Finance chart API', sourceAsOf: '2026-09-23T20:00:00Z', exchangeTimezone: 'America/New_York', partialBarExcluded: false, rejectedBarCount: 0,
  bars: chartData.map((bar) => ({ time: bar.date_iso, open: bar.open, high: bar.high, low: bar.low, close: bar.price, volume: bar.volume })),
  analysis: { recentMatches: [], patternBias: 'neutral', trendContext: 'neutral' },
}, cache });
module.exports = { result, snapshot, candles };
