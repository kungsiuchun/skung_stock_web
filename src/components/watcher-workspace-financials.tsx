import { useEffect, useState } from "react";
import type { WorkspaceClient, WorkspaceResource } from "@/hooks/use-watcher-workspace";
import type { WatcherFinancialStatements, WatcherValuationBands, WatcherValuationMetric } from "@/lib/stocks-watcher-valuation-data";
import { ValuationRainbowChart } from "./stocks-intelligence-watcher-leaf-components";

const amount = (n: number | null, currency: string | null) => n === null || !Number.isFinite(n) ? "Unavailable" : `${currency || "Currency unknown"} ${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n)}`;
export function WatcherWorkspaceFinancials({ symbol, client, earnings = false }: { symbol: string; client: WorkspaceClient; earnings?: boolean }) {
  const [financial, setFinancial] = useState<WorkspaceResource<WatcherFinancialStatements>>({ data: null, loading: true, error: null });
  const [valuation, setValuation] = useState<WorkspaceResource<WatcherValuationBands>>({ data: null, loading: false, error: null });
  const [metric, setMetric] = useState<WatcherValuationMetric>("pe");
  useEffect(() => {
    const controller = new AbortController(); setFinancial({ data: null, loading: true, error: null });
    void client.tool("get_financial_statements", { symbol, periods: 8 }, controller.signal).then(result => {
      const data = result.raw as WatcherFinancialStatements;
      if (data.symbol !== symbol || !data.financialSource?.source || !Array.isArray(data.quarters) || !data.quarters.length) throw new Error("Published financials could not be verified.");
      if (!controller.signal.aborted) setFinancial({ data, loading: false, error: null });
    }).catch(error => { if (!controller.signal.aborted) setFinancial({ data: null, loading: false, error: error.message }); });
    return () => controller.abort();
  }, [symbol, client]);
  useEffect(() => {
    if (earnings) return;
    const controller = new AbortController(); setValuation({ data: null, loading: true, error: null });
    void client.tool("get_valuation_bands", { symbol, metric, window: "3Y" }, controller.signal).then(result => {
      const data = result.raw as WatcherValuationBands;
      if (data.symbol !== symbol || data.metric !== metric || !data.latest || !Array.isArray(data.points)) throw new Error("Published valuation identity is invalid.");
      if (!controller.signal.aborted) setValuation({ data, loading: false, error: null });
    }).catch(error => { if (!controller.signal.aborted) setValuation({ data: null, loading: false, error: error.message }); });
    return () => controller.abort();
  }, [symbol, metric, client, earnings]);
  return <div className="ww-financials"><div className="ww-card-heading"><div><span className="ww-kicker">REPORTED, NOT ESTIMATED</span><h2>{earnings ? "Earnings & cash generation" : "Fundamentals & valuation"}</h2></div><span className="ww-badge">Published financials</span></div>
    {financial.loading && <p role="status">Loading published financial statements…</p>}{financial.error && <div role="alert" className="ww-notice"><strong>Published financials unavailable.</strong><p>The published calculation source could not be verified.</p><details><summary>Data details</summary><p>{financial.error}</p></details></div>}
    {financial.data && <><p className="ww-muted">{financial.data.financialSource.source} · Reported through {financial.data.dataAsOf} · Filed {financial.data.financialSource.filingDate || "Date unavailable"}</p><div className="ww-scroll"><table><thead><tr><th>Fiscal period</th><th>Revenue</th><th>Net income</th><th>EPS</th><th>Operating cash flow</th><th>Free cash flow</th></tr></thead><tbody>{financial.data.quarters.map(row => <tr key={row.date}><th>{row.date}<small>{row.period || ""}</small></th><td>{amount(row.revenue, row.currency)}</td><td>{amount(row.netIncome, row.currency)}</td><td>{row.eps === null ? "Unavailable" : row.eps.toFixed(2)}</td><td>{amount(row.operatingCashFlow, row.currency)}</td><td>{amount(row.freeCashFlow, row.currency)}</td></tr>)}</tbody></table></div><p className="ww-footnote">Statement dates, filing dates and publication times are separate. Upcoming earnings timing is not supplied by these reported financials.</p>{financial.data.financialSource.sourceUrl?.startsWith("https://") && <a href={financial.data.financialSource.sourceUrl} target="_blank" rel="noreferrer">Source dataset/reference ↗</a>}</>}
    {!earnings && <section className="ww-valuation"><div className="ww-card-heading"><h3>Historical valuation bands</h3><label>Metric<select value={metric} onChange={e => setMetric(e.target.value as WatcherValuationMetric)}><option value="pe">P/E</option><option value="fcf">Free cash flow</option><option value="ps">Price / sales</option></select></label></div>{valuation.loading && <p role="status">Loading published valuation…</p>}{valuation.error && <div className="ww-notice" role="alert"><p>Published valuation unavailable.</p><details><summary>Data details</summary><p>{valuation.error}</p></details></div>}{valuation.data && <><ValuationRainbowChart valuation={valuation.data} /><p className="ww-footnote">ValuationCalculation · As of {valuation.data.dataAsOf} · Historical mean and bands are references, not price targets.</p></>}</section>}
  </div>;
}
