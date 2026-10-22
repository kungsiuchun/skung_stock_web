import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, LayoutGrid, List, Newspaper, RefreshCw, Search } from "lucide-react";
import { newsArticlesFromResult, rawNullableNumber, rawNullableString, rawRecord } from "./stocks-intelligence-watcher-view-model";
import type { NativeToolResult } from "./stocks-intelligence-watcher-view-model";
import "./stocks-watcher-news-panel.css";

type NewsTool = "pre_event_brief" | "morning_briefing";
export type NewsToolValue = { result: NativeToolResult; fetchedAt: number };
export type NewsToolLoader = (tool: NewsTool, symbol: string, force?: boolean) => Promise<NewsToolValue>;
const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short",
});
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const numberText = (value: unknown) => {
  const number = rawNullableNumber(value);
  return number === null ? "Unavailable" : numberFormat.format(number);
};
const timeText = (value: string | number | null | undefined) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? dateFormat.format(date) : "Time unavailable";
};

// Each mounted ticker owns its response. Cleanup discards late replies, while
// the page's existing tool cache/log remains the source of request traceability.
function useNewsTool(tool: NewsTool, symbol: string, loadTool: NewsToolLoader) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ loading: boolean; error: string | null; value: NewsToolValue | null }>({ loading: true, error: null, value: null });
  useEffect(() => {
    let current = true;
    setState({ loading: true, error: null, value: null });
    void loadTool(tool, symbol, revision > 0).then(value => {
      if (current) setState({ loading: false, error: null, value });
    }).catch((error: unknown) => {
      if (current) setState({ loading: false, error: error instanceof Error ? error.message : String(error), value: null });
    });
    return () => { current = false; };
  }, [tool, symbol, loadTool, revision]);
  return { ...state, retry: () => setRevision(value => value + 1) };
}

function NewsError({ message, retry, label = "Retry news" }: { message: string; retry: () => void; label?: string }) {
  return <div className="siw-newsroom-error" role="alert"><p>{message}</p><button type="button" onClick={retry}>{label}</button></div>;
}

function MarketPulse({ symbol, loadTool }: { symbol: string; loadTool: NewsToolLoader }) {
  const pulse = useNewsTool("morning_briefing", symbol, loadTool);
  const [showAll, setShowAll] = useState(false);
  const raw = rawRecord(pulse.value?.result.raw);
  const suppliedRows = raw?.briefingQuotes ?? raw?.quotes;
  const rows = Array.isArray(suppliedRows) ? suppliedRows.flatMap(value => {
    const quote = rawRecord(value);
    const ticker = rawNullableString(quote?.symbol);
    return ticker ? [{ symbol: ticker, change: rawNullableNumber(quote?.changePercent), asOf: rawNullableString(quote?.asOf) }] : [];
  }) : null;
  return <div className="siw-newsroom-pulse">
    <p>Separate market context, not article sentiment. This tool’s supplied universe is not the visible watchlist or the whole market.</p>
    {pulse.loading && <p role="status">Loading market pulse…</p>}
    {pulse.error && <NewsError message={pulse.error} retry={pulse.retry} label="Retry market pulse" />}
    {pulse.value && !rows && <NewsError message="The briefing did not return structured quotes." retry={pulse.retry} label="Retry market pulse" />}
    {rows && <>
      <p className="siw-newsroom-small">{rows.length} supplied assets · Loaded {timeText(pulse.value?.fetchedAt)}</p>
      {Array.isArray(suppliedRows) && suppliedRows.length > rows.length && <p className="siw-newsroom-warning">{suppliedRows.length - rows.length} quote rows without a ticker were omitted. Inspect briefing data details.</p>}
      {rows.length === 0 && <p>No quote rows were supplied. Open data details or retry the briefing.</p>}
      <dl>{(showAll ? rows : rows.slice(0, 5)).map((row, index) => <div key={`${row.symbol}-${index}`}>
        <dt>{row.symbol}<small>{timeText(row.asOf)}</small></dt>
        <dd className={row.change === null ? "" : row.change >= 0 ? "siw-up" : "siw-down"}>{row.change === null ? "Unavailable" : `${row.change >= 0 ? "+" : ""}${numberFormat.format(row.change)}%`}</dd>
      </div>)}</dl>
      {rows.length > 5 && <button type="button" onClick={() => setShowAll(value => !value)}>{showAll ? "Show fewer quotes" : `Show all ${rows.length} quotes`}</button>}
      <details className="siw-newsroom-raw"><summary>Briefing data details</summary><pre tabIndex={0} role="region" aria-label="Raw briefing report">{`${pulse.value?.result.text || "No source text supplied."}\n\nStructured quotes:\n${JSON.stringify(suppliedRows, null, 2)}`}</pre></details>
    </>}
  </div>;
}

export function StocksWatcherNewsPanel({ symbol, loadTool }: { symbol: string; loadTool: NewsToolLoader }) {
  const news = useNewsTool("pre_event_brief", symbol, loadTool);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [view, setView] = useState<"cards" | "compact">("cards");
  const [pulseOpen, setPulseOpen] = useState(false);
  const parsed = useMemo(() => {
    if (!news.value) return { articles: [], omittedCount: 0, error: null };
    try { return { ...newsArticlesFromResult(news.value.result), error: null }; }
    catch (error) { return { articles: [], omittedCount: 0, error: error instanceof Error ? error.message : String(error) }; }
  }, [news.value]);
  const publisher = (value: string | null) => value || "Source unavailable";
  const sources = Array.from(new Set(parsed.articles.map(article => publisher(article.publisher)))).sort();
  const visible = parsed.articles.filter(article => (!source || publisher(article.publisher) === source)
    && `${article.title} ${article.publisher || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const groups = new Map<string, typeof visible>();
  for (const article of visible) {
    const day = article.publishedAt ? dayFormat.format(new Date(article.publishedAt)) : "Publication date unavailable";
    groups.set(day, [...(groups.get(day) || []), article]);
  }
  const raw = rawRecord(news.value?.result.raw);
  const stats = rawRecord(raw?.stats);
  const quote = rawRecord(stats?.quote);
  const summary = rawRecord(stats?.summary);
  const keys = rawRecord(summary?.defaultKeyStatistics);
  const oneMonthReturn = rawNullableNumber(raw?.oneMonthReturn);
  const error = news.error || parsed.error;
  const clearFilters = () => { setQuery(""); setSource(""); };
  return <section className={`siw-panel siw-primary-panel siw-newsroom is-${view}`} data-primary-tab-panel="News" data-newsroom aria-labelledby="siw-newsroom-title">
    <header className="siw-newsroom-header">
      <div><p className="siw-newsroom-eyebrow">The ticker desk</p><h2 id="siw-newsroom-title">{symbol} Newsroom</h2><p>Headlines first. Context when you need it.</p></div>
      <button type="button" onClick={news.retry} disabled={news.loading}><RefreshCw aria-hidden="true" size={15} />{news.loading ? "Loading news…" : "Refresh news"}</button>
    </header>
    <div className="siw-newsroom-toolbar">
      <label className="siw-newsroom-search"><Search aria-hidden="true" size={16} /><span className="sr-only">Search news headlines</span><input name="news-search" type="search" autoComplete="off" placeholder="Search headlines or sources…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label className="siw-newsroom-source"><span className="sr-only">News source</span><select name="news-source" value={source} onChange={event => setSource(event.target.value)}><option value="">All sources</option>{source && !sources.includes(source) && <option value={source}>{source} (no articles)</option>}{sources.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      <div className="siw-newsroom-view" role="group" aria-label="News layout">
        <button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")}><LayoutGrid aria-hidden="true" size={15} />Cards</button>
        <button type="button" aria-pressed={view === "compact"} onClick={() => setView("compact")}><List aria-hidden="true" size={15} />Compact</button>
      </div>
    </div>
    <p className="siw-newsroom-status" role="status" aria-live="polite">{news.loading ? "Loading source headlines…" : error ? "News could not be loaded." : `${visible.length} of ${parsed.articles.length} articles · Newest first`}{news.value && !error && <span>{raw?.source === "native_yahoo" ? "Yahoo search" : "Provider search"} · Loaded {timeText(news.value.fetchedAt)}</span>}</p>
    {error && <NewsError message={error} retry={news.retry} />}
    <div className="siw-newsroom-desk">
      <div className="siw-newsroom-feed" aria-busy={news.loading}>
        {news.loading && <div className="siw-newsroom-skeleton" aria-hidden="true"><div /><div /><div /></div>}
        {!news.loading && !error && parsed.articles.length === 0 && <div className="siw-newsroom-empty"><Newspaper aria-hidden="true" size={24} /><h3>No headlines received for {symbol}</h3><p>The source returned no articles. It does not distinguish an empty feed from every upstream news failure.</p><button type="button" onClick={news.retry}>Retry news</button></div>}
        {!news.loading && !error && parsed.articles.length > 0 && visible.length === 0 && <div className="siw-newsroom-empty"><h3>No matching headlines</h3><p>Try a different search or source.</p><button type="button" onClick={clearFilters}>Clear filters</button></div>}
        {!news.loading && !error && Array.from(groups, ([day, articles]) => <section className="siw-newsroom-day" key={day} aria-label={day}>
          <h3>{day}</h3><div className="siw-newsroom-cards">{articles.map(article => <article key={article.id} data-news-article className={`siw-newsroom-article ${article.id === parsed.articles[0]?.id ? "is-leading" : ""}`}>
            <div className="siw-newsroom-meta"><span>{publisher(article.publisher)}</span>{article.publishedAt ? <time dateTime={article.publishedAt}>{timeText(article.publishedAt)}</time> : <span>Publication time unavailable</span>}</div>
            {article.id === parsed.articles[0]?.id && article.publishedAt && <span className="siw-newsroom-latest">Latest in this feed</span>}
            <h4>{article.link ? <a href={article.link} target="_blank" rel="noopener noreferrer">{article.title}</a> : article.title}</h4>
            <footer><span className="siw-newsroom-ticker">{symbol} search result</span>{article.link ? <a href={article.link} target="_blank" rel="noopener noreferrer">Read original<ArrowUpRight aria-hidden="true" size={15} /></a> : <span>Original link unavailable</span>}</footer>
          </article>)}</div>
        </section>)}
        {parsed.omittedCount > 0 && <p className="siw-newsroom-warning">{parsed.omittedCount} malformed entries without a headline were omitted. Open data details to inspect the source.</p>}
        {!news.loading && !error && parsed.articles.length > 0 && <p className="siw-newsroom-disclaimer">Headlines only: this source does not provide article summaries or images. Open the original for the full story. Search results are not a relevance or investment rating.</p>}
      </div>
      <aside className="siw-newsroom-context" aria-label="News context">
        {news.value && !error && <section className="siw-newsroom-context-card"><p className="siw-newsroom-eyebrow">Context, not a news story</p><h3>{symbol} at a glance</h3><dl>
          <div><dt>1M price context</dt><dd className={oneMonthReturn === null ? "" : oneMonthReturn >= 0 ? "siw-up" : "siw-down"}>{oneMonthReturn === null ? "Unavailable" : `${oneMonthReturn >= 0 ? "+" : ""}${numberFormat.format(oneMonthReturn)}%`}</dd></div>
          <div><dt>Forward P/E</dt><dd>{numberText(rawRecord(keys?.forwardPE)?.raw)}</dd></div>
          <div><dt>Beta</dt><dd>{numberText(rawRecord(keys?.beta)?.raw)}</dd></div>
          <div><dt>Exchange</dt><dd>{rawNullableString(quote?.exchange) || "Unavailable"}</dd></div>
        </dl><p className="siw-newsroom-small">Source quote: {timeText(rawNullableString(quote?.asOf))}. Values come from the source; they do not explain why an article matters.</p></section>}
        <details className="siw-newsroom-context-card" onToggle={event => setPulseOpen(event.currentTarget.open)}><summary>Market pulse <span>On demand</span></summary>{pulseOpen && <MarketPulse symbol={symbol} loadTool={loadTool} />}</details>
        <details className="siw-newsroom-context-card siw-newsroom-raw"><summary>Data & source details</summary><p className="siw-newsroom-small">Provider/tool output for debugging, not a news article. No AI summary is generated.</p><pre tabIndex={0} role="region" aria-label="Raw news context report">{news.value ? `${news.value.result.tool}\n\n${news.value.result.text || "No source text supplied."}\n\nStructured articles:\n${JSON.stringify(raw?.news, null, 2)}` : "No news response loaded."}</pre></details>
      </aside>
    </div>
  </section>;
}
