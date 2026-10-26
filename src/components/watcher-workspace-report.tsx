import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Download, Send, Sparkles } from "lucide-react";

interface Report { content: string; symbol: string; generatedAt: string; evidenceVersion: string; model: string; lens: string; language: string; sources: Array<{ id: string; label: string; asOf: string | null }>; cache?: { status: string } }
export function WatcherWorkspaceReport({ symbol, currentQuoteAsOf }: { symbol: string; currentQuoteAsOf?: string | null }) {
  const [lens, setLens] = useState("swing");
  const [language, setLanguage] = useState("zh-TW");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState<Array<{ role: "user" | "assistant"; content: string; asOf?: string; facts?: string }>>([]);
  const abort = useRef<AbortController | null>(null);
  const reports = useRef(new Map<string, Report>());
  const reportKey = `${symbol}:${lens}:${language}`;
  useEffect(() => { if (blockedUntil === null) return; const timer = window.setTimeout(() => setBlockedUntil(null), Math.max(1, blockedUntil - Date.now())); return () => window.clearTimeout(timer); }, [blockedUntil]);
  useEffect(() => { abort.current?.abort(); setReport(reports.current.get(reportKey) || null); setError(null); setErrorDetail(null); setBusy(false); setConversation([]); return () => abort.current?.abort(); }, [reportKey]);
  const request = async (chat: boolean) => {
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller; setBusy(true); setError(null); setErrorDetail(null);
    const text = question.trim();
    try {
      const response = await fetch(chat ? "/api/agent/chat" : "/api/research/report", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify(chat ? { symbol, message: text, language, history: conversation.slice(-6).map(({ role, content }) => ({ role, content })) } : { symbol, lens, language }) });
      const data = await response.json();
      if (!response.ok || !data.success) {
        if (response.status === 429) { const retry = Date.parse(data.retryAt); setBlockedUntil(Number.isFinite(retry) && retry > Date.now() ? retry : Date.now() + 60_000); }
        throw new Error(data.error || "The free assistant is unavailable.");
      }
      if (controller.signal.aborted) return;
      if (chat) { if (data.symbol !== symbol || typeof data.reply !== "string" || typeof data.facts !== "string") throw new Error("The assistant returned mismatched research."); setConversation(current => [...current.slice(-18), { role: "user", content: text }, { role: "assistant", content: data.reply, facts: data.facts, asOf: data.sources?.find((source: { id: string }) => source.id === "Q")?.asOf }]); setQuestion(""); }
      else { if (data.report?.symbol !== symbol || typeof data.report.content !== "string" || !Array.isArray(data.report.sources)) throw new Error("The report failed validation."); setReport(data.report); reports.current.set(reportKey, data.report); }
    } catch (error) { if (!controller.signal.aborted) { setError("The research assistant is unavailable."); setErrorDetail(error instanceof Error ? error.message : String(error)); } }
    finally { if (abort.current === controller) setBusy(false); }
  };
  const download = () => {
    if (!report) return;
    const text = `${report.content}\n\nSources:\n${report.sources.map(s => `[${s.id}] ${s.label} · ${s.asOf || "Time unavailable"}`).join("\n")}\n\nGenerated: ${report.generatedAt}\nEvidence: ${report.evidenceVersion}`;
    const href = URL.createObjectURL(new Blob([text], { type: "text/markdown" })); const a = document.createElement("a"); a.href = href; a.download = `${symbol}-${lens}-research.md`; a.click(); URL.revokeObjectURL(href);
  };
  return <section className="ww-report"><div className="ww-card-heading"><div><span className="ww-kicker">EVIDENCE → INTERPRETATION</span><h2>{symbol} research brief</h2></div><span className="ww-badge">Free AI · shared allowance</span></div>
    <div className="ww-actions"><label>Lens<select value={lens} onChange={e => setLens(e.target.value)}><option value="swing">Swing research</option><option value="quality">Business quality</option><option value="risk">Risk review</option></select></label><label>Report language<select value={language} onChange={e => setLanguage(e.target.value)}><option value="zh-TW">繁體中文</option><option value="en">English</option></select></label><button className="ww-primary" disabled={busy || blockedUntil !== null} onClick={() => void request(false)}><Sparkles size={15} />{busy ? "Working…" : blockedUntil ? "Free allowance reached" : report ? "Refresh report" : "Generate report"}</button>{report && <button onClick={download}><Download size={15} /> Export</button>}</div>
    <p className="ww-footnote">Generated only when requested. All visitors share 40 model attempts per UTC day and 10 per minute. Cached reports are shared; saved plans and watchlist tags stay in your browser.</p>
    {error && <div role="alert" className="ww-notice"><p>{error}</p>{errorDetail && <details><summary>Data details</summary><p>{errorDetail}</p></details>}</div>}
    {report && currentQuoteAsOf && Date.parse(report.sources.find(source => source.id === "Q")?.asOf || "") < Date.parse(currentQuoteAsOf) && <p className="ww-notice">This report uses an earlier quote than the current research view. Generate a new report to update its evidence.</p>}
    {busy && <p role="status">Reading public evidence and requesting one free-model response…</p>}
    {report ? <><div className="ww-markdown"><ReactMarkdown disallowedElements={["img"]}>{report.content}</ReactMarkdown></div><div className="ww-source-list">{report.sources.map(source => <p key={source.id}>[{source.id}] {source.label} · {source.asOf || "Source time unavailable"}</p>)}<p>Generated {report.generatedAt} · {report.cache?.status === "hit" ? "Shared cached report" : "New report"}</p><details><summary>Model and evidence details</summary><p>{report.model} · {report.evidenceVersion}</p></details></div></> : <div className="ww-empty"><h3>Read the facts. Then ask for interpretation.</h3><p>The brief separates support, counterchecks, risk and data gaps. A report is an interpretation of dated sources.</p></div>}
    <div className="ww-chat"><h3>Ask about {symbol}</h3><p className="ww-footnote">Uses the same stock and server-verified public evidence. Your submitted question and recent conversation are sent to the free provider.</p>{conversation.map((message, index) => <div className={`ww-message ${message.role}`} key={index}><small>{message.role === "user" ? "You" : symbol + " research assistant"}{message.asOf ? ` · Quote ${message.asOf}` : ""}</small><ReactMarkdown disallowedElements={["img"]}>{message.content}</ReactMarkdown>{message.facts && <details className="ww-source-list"><summary>Verified figures and dates</summary><ReactMarkdown disallowedElements={["img"]}>{message.facts}</ReactMarkdown></details>}</div>)}<form onSubmit={event => { event.preventDefault(); if (question.trim()) void request(true); }}><label className="sr-only" htmlFor="ww-question">Ask a research question</label><textarea id="ww-question" value={question} maxLength={2000} onChange={e => setQuestion(e.target.value)} placeholder={`What evidence challenges the ${symbol} thesis?`} required /><button className="ww-primary" disabled={busy || blockedUntil !== null || !question.trim()}><Send size={15} /> Ask</button></form></div>
  </section>;
}
