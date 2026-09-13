import type { FearGreedSnapshot } from "@/lib/fear-greed";
import { fearGreedLabel, fearGreedTone } from "@/lib/fear-greed";
import type { MarketCacheMetadata } from "@/lib/market-data-cache";

interface StocksWatcherFearGreedPanelProps {
  snapshot: FearGreedSnapshot;
  cache: MarketCacheMetadata | null;
  onRefresh: () => void;
}

const chartPoint = (score: number, index: number, length: number) => {
  const x = length <= 1 ? 0 : (index / (length - 1)) * 100;
  const y = 100 - score;
  return `${x.toFixed(2)},${y.toFixed(2)}`;
};

const formatAsOf = (value: string) => new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
}).format(new Date(value));

const formatHistoryDate = (value: string) => new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
}).format(new Date(value));

const formatScore = (value: number | null) => value === null ? "—" : value.toFixed(1);

const cacheLabel = (cache: MarketCacheMetadata | null) => {
  if (!cache) return "Cache metadata unavailable";
  if (cache.status === "stale") return "Stale cached reading";
  if (cache.status === "hit") return `D1 cache hit · ${cache.ageSeconds}s old`;
  if (cache.status === "refreshed") return "D1 cache refreshed";
  return "D1 cache bypassed";
};

const FEAR_GREED_STAGES = [
  { label: "Extreme Fear", range: "0–24", tone: "extreme-fear", start: 0, end: 25 },
  { label: "Fear", range: "25–44", tone: "fear", start: 25, end: 45 },
  { label: "Neutral", range: "45–55", tone: "neutral", start: 45, end: 56 },
  { label: "Greed", range: "56–74", tone: "greed", start: 56, end: 75 },
  { label: "Extreme Greed", range: "75–100", tone: "extreme-greed", start: 75, end: 100 },
] as const;

const gaugeMarker = (score: number) => {
  const angle = Math.PI - (score / 100) * Math.PI;
  return { x: 110 + 86 * Math.cos(angle), y: 112 - 86 * Math.sin(angle) };
};

export function StocksWatcherFearGreedPanel({ snapshot, cache, onRefresh }: StocksWatcherFearGreedPanelProps) {
  const tone = fearGreedTone(snapshot.rating);
  const linePoints = snapshot.history.map((point, index) => chartPoint(point.score, index, snapshot.history.length)).join(" ");
  const latestHistory = snapshot.history[snapshot.history.length - 1] || { score: snapshot.score, at: snapshot.asOf };
  const marker = gaugeMarker(snapshot.score);
  const comparisons = [
    ["Prev close", snapshot.comparisons.previousClose],
    ["1 week", snapshot.comparisons.previousWeek],
    ["1 month", snapshot.comparisons.previousMonth],
    ["1 year", snapshot.comparisons.previousYear],
  ] as const;

  return (
    <div className="siw-fear-greed" data-fear-greed-panel>
      <header className="siw-fear-greed-head">
        <div>
          <span className="siw-eyebrow">Market sentiment</span>
          <h2>CNN Fear &amp; Greed Index</h2>
          <p>Broad US market sentiment · score is 0–100</p>
        </div>
        <div className={`siw-fear-greed-status is-${tone}`}>
          <strong>{fearGreedLabel(snapshot.rating)}</strong>
          <span>as of {formatAsOf(snapshot.asOf)}</span>
        </div>
      </header>

      <div className="siw-fear-greed-grid">
        <section className={`siw-fear-greed-gauge-card is-${tone}`} data-fear-greed-gauge>
          <div className="siw-fear-greed-gauge-wrap">
            <svg viewBox="0 0 220 132" role="img" aria-label={`Fear and Greed score ${snapshot.score.toFixed(1)} of 100: ${fearGreedLabel(snapshot.rating)}`}>
              <path className="siw-fear-greed-track" d="M 24 112 A 86 86 0 0 1 196 112" pathLength="100" />
              {FEAR_GREED_STAGES.map((stage) => (
                <path
                  key={stage.tone}
                  className={`siw-fear-greed-stage is-${stage.tone}`}
                  d="M 24 112 A 86 86 0 0 1 196 112"
                  pathLength="100"
                  strokeDasharray={`${stage.end - stage.start} 100`}
                  strokeDashoffset={-stage.start}
                />
              ))}
              <circle className={`siw-fear-greed-marker is-${tone}`} cx={marker.x} cy={marker.y} r="7" />
            </svg>
            <div className="siw-fear-greed-reading" aria-live="polite"><strong>{snapshot.score.toFixed(1)}</strong><span>/ 100</span></div>
            <div className={`siw-fear-greed-current is-${tone}`}>Current: <strong>{fearGreedLabel(snapshot.rating)}</strong></div>
          </div>
          <ol className="siw-fear-greed-stages" data-fear-greed-stages aria-label="Fear and Greed score ranges">
            {FEAR_GREED_STAGES.map((stage) => (
              <li key={stage.tone} className={`is-${stage.tone} ${stage.tone === tone ? "is-current" : ""}`}>
                <i aria-hidden="true" />
                <span>{stage.range}</span>
                <strong>{stage.label}</strong>
              </li>
            ))}
          </ol>
        </section>

        <section className="siw-fear-greed-history-card" data-fear-greed-line-chart>
          <div className="siw-fear-greed-card-head"><div><span className="siw-eyebrow">History</span><h3>One-year trend</h3></div><span>{snapshot.history.length} observations</span></div>
          <div className="siw-fear-greed-chart" aria-label="CNN Fear and Greed one year line chart">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img">
              <line className="siw-fear-greed-gridline" x1="0" y1="25" x2="100" y2="25" />
              <line className="siw-fear-greed-gridline" x1="0" y1="50" x2="100" y2="50" />
              <line className="siw-fear-greed-gridline" x1="0" y1="75" x2="100" y2="75" />
              <polyline className="siw-fear-greed-line" points={linePoints} vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="siw-fear-greed-chart-labels" aria-hidden="true"><span>100</span><span>50</span><span>0</span></div>
          </div>
          <div className="siw-fear-greed-history-footer"><span>{formatHistoryDate(snapshot.history[0].at)}</span><span>Latest: {latestHistory.score.toFixed(1)}</span><span>{formatHistoryDate(latestHistory.at || snapshot.asOf)}</span></div>
        </section>
      </div>

      <section className="siw-fear-greed-comparisons" aria-label="Fear and Greed comparison levels">
        {comparisons.map(([label, value]) => {
          const stage = value === null ? null : FEAR_GREED_STAGES.find((candidate) => value < candidate.end) || FEAR_GREED_STAGES[FEAR_GREED_STAGES.length - 1];
          return <div key={label} className={stage ? `is-${stage.tone}` : "is-unavailable"}>
            <span>{label}</span><strong>{formatScore(value)}</strong>{stage && <em>{stage.label}</em>}
          </div>;
        })}
      </section>

      <footer className={`siw-fear-greed-source ${cache?.status === "stale" ? "is-stale" : ""}`} data-fear-greed-cache>
        <span><b /> {cacheLabel(cache)}</span>
        <span>TTL: 15 min</span>
        <a href={snapshot.sourceUrl} target="_blank" rel="noreferrer">Source: CNN</a>
        <button type="button" onClick={onRefresh}>Refresh</button>
      </footer>
    </div>
  );
}
