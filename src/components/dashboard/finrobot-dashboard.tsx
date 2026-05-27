"use client";

import { useState } from 'react';
import { Bot, Send, Download, Activity, Eye, FileText, X } from 'lucide-react';
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const sanitizeUrl = (value: string) => {
  const trimmed = value.trim();
  if (/^(https?:|mailto:|#)/i.test(trimmed)) return escapeHtml(trimmed);
  return "#";
};

const renderInlineMarkdown = (value: string) => {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
      return `<a href="${sanitizeUrl(url)}" target="_blank" rel="noreferrer">${label}</a>`;
    });
};

const markdownToSafeHtml = (markdown: string) => {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inCodeBlock = false;
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      closeList();
      html.push(inCodeBlock ? "</code></pre>" : "<pre><code>");
      inCodeBlock = !inCodeBlock;
      return;
    }

    if (inCodeBlock) {
      html.push(`${escapeHtml(line)}\n`);
      return;
    }

    if (!trimmed) {
      closeList();
      return;
    }

    if (/^---+$/.test(trimmed)) {
      closeList();
      html.push("<hr />");
      return;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      return;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${renderInlineMarkdown(unordered[1])}</li>`);
      return;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${renderInlineMarkdown(ordered[1])}</li>`);
      return;
    }

    const quote = trimmed.match(/^>\s?(.+)$/);
    if (quote) {
      closeList();
      html.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
      return;
    }

    closeList();
    html.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
  });

  closeList();
  if (inCodeBlock) html.push("</code></pre>");
  return html.join("\n");
};

const buildHtmlReport = (ticker: string, markdown: string, generatedAt: string) => {
  const safeTicker = escapeHtml(ticker);
  const safeGeneratedAt = escapeHtml(generatedAt || new Date().toLocaleString());
  const bodyHtml = markdownToSafeHtml(markdown);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTicker} Equity Research Report</title>
  <style>
    :root { color: #111827; background: #f3f4f6; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f3f4f6; }
    .report-shell { max-width: 920px; margin: 0 auto; padding: 48px 24px; }
    .report { background: #ffffff; border: 1px solid #e5e7eb; box-shadow: 0 24px 80px rgba(15, 23, 42, 0.12); }
    .masthead { border-bottom: 1px solid #e5e7eb; padding: 34px 42px 28px; }
    .eyebrow { color: #0891b2; font-size: 12px; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; }
    h1 { margin: 12px 0 10px; font-size: 36px; line-height: 1.08; letter-spacing: -0.03em; color: #0f172a; }
    .meta { color: #64748b; font-size: 13px; display: flex; flex-wrap: wrap; gap: 14px; }
    .content { padding: 34px 42px 44px; font-size: 15px; line-height: 1.75; }
    .content h1 { font-size: 30px; margin: 0 0 22px; }
    .content h2 { margin: 34px 0 12px; font-size: 21px; color: #0f172a; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
    .content h3 { margin: 24px 0 8px; font-size: 17px; color: #1f2937; }
    .content p { margin: 0 0 14px; color: #374151; }
    .content ul, .content ol { margin: 0 0 18px 22px; padding: 0; color: #374151; }
    .content li { margin: 6px 0; }
    .content strong { color: #0f172a; }
    .content a { color: #0e7490; font-weight: 700; text-decoration: none; }
    .content blockquote { margin: 18px 0; padding: 14px 18px; border-left: 4px solid #06b6d4; background: #ecfeff; color: #155e75; }
    .content code { font-family: "SFMono-Regular", Consolas, monospace; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 5px; padding: 1px 5px; }
    .content pre { overflow-x: auto; background: #0f172a; color: #e2e8f0; padding: 16px; border-radius: 8px; }
    .content pre code { background: transparent; border: 0; color: inherit; padding: 0; }
    .content hr { border: 0; border-top: 1px solid #e5e7eb; margin: 28px 0; }
    @media (max-width: 700px) { .report-shell { padding: 20px 10px; } .masthead, .content { padding-left: 22px; padding-right: 22px; } h1 { font-size: 28px; } }
  </style>
</head>
<body>
  <main class="report-shell">
    <article class="report">
      <header class="masthead">
        <div class="eyebrow">FinRobot Analyst</div>
        <h1>${safeTicker} Equity Research Report</h1>
        <div class="meta">
          <span>Generated: ${safeGeneratedAt}</span>
          <span>Source: TypeScript Multi-Agent Analysis</span>
        </div>
      </header>
      <section class="content">
${bodyHtml}
      </section>
    </article>
  </main>
</body>
</html>`;
};

export function FinRobotDashboard() {
  const [ticker, setTicker] = useState('NVDA');
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [reportReady, setReportReady] = useState(false);
  const [finalReport, setFinalReport] = useState<string>('');
  const [reportGeneratedAt, setReportGeneratedAt] = useState<string>('');
  const [isHtmlPreviewOpen, setIsHtmlPreviewOpen] = useState(false);

  const startAnalysis = async () => {
    if (!ticker) return;
    setIsRunning(true);
    setReportReady(false);
    setFinalReport('');
    setReportGeneratedAt('');
    setIsHtmlPreviewOpen(false);
    setLogs(["[Director Agent] Initializing TS Multi-Agent analysis for " + ticker + "..."]);
    
    try {
      const res = await fetch("/api/finrobot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker })
      });

      const data = await res.json();
      
      if (data.error) {
        setLogs(prev => [...prev, "❌ Error: " + data.error]);
      } else {
        // Stream out steps
        if (data.steps && data.steps.length > 0) {
           data.steps.forEach((step: any, index: number) => {
             setTimeout(() => {
               if (step.type === "tool_call") {
                 setLogs(prev => [...prev, `[Perception Agent] Used tool: ${step.tool_name}`]);
               } else if (step.type === "final_answer") {
                 setLogs(prev => [...prev, "[Action Agent] Formatting technicals and risks into Markdown report..."]);
               }
             }, index * 800); // Stagger log output for UX
           });
        }
        
        setTimeout(() => {
          setLogs(prev => [...prev, "✅ Execution complete. Equity Research Report generated!"]);
          setFinalReport(data.report || "No report generated.");
          setReportGeneratedAt(new Date().toLocaleString());
          setReportReady(true);
          setIsRunning(false);
        }, (data.steps?.length || 1) * 800 + 500);
      }
    } catch (err: any) {
      setLogs(prev => [...prev, "❌ Terminal Error: Failed to connect to Analysis Agent"]);
      setIsRunning(false);
    }
  };

  const downloadReport = () => {
    const reportContent = finalReport || `# ${ticker} Equity Research Report\n\nError: Report missing.`;
    const blob = new Blob([reportContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ticker}_Equity_Report.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadHtmlReport = () => {
    const reportContent = finalReport || `# ${ticker} Equity Research Report\n\nError: Report missing.`;
    const htmlReport = buildHtmlReport(ticker, reportContent, reportGeneratedAt);
    const blob = new Blob([htmlReport], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ticker}_Equity_Report.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
    <div className="w-full h-full flex flex-col items-center p-6 sm:p-12 z-10 pointer-events-auto overflow-y-auto text-white">
      <div className="max-w-5xl w-full">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-xl bg-cyan-500/20 flex items-center justify-center border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
            <Bot className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tighter text-white">FinRobot Analyst</h2>
            <p className="text-white/60">Autonomous Equity Research powered by TypeScript Multi-Agent</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Output Panel */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <div className="rounded-[1.5rem] border-[0.75px] border-white/10 bg-black/40 backdrop-blur-md p-6 h-[500px] flex flex-col shadow-xl">
               <h3 className="text-xl font-semibold mb-4 flex items-center gap-2 text-white/90">
                 <Activity className="w-5 h-5 text-cyan-400" /> Agent Execution Logs
               </h3>
               
               <div className="flex-1 bg-[#0a0f16] rounded-xl border border-white/5 p-4 font-mono text-sm overflow-y-auto text-white/70">
                 {logs.length === 0 ? (
                   <span className="text-white/30 italic">Waiting for instructions...</span>
                 ) : (
                   logs.map((log, i) => (
                     <div key={i} className="mb-2 animate-in fade-in slide-in-from-bottom-2">
                       <span className="text-cyan-500/50">[{new Date().toLocaleTimeString()}]</span> {log}
                     </div>
                   ))
                 )}
                 {isRunning && (
                   <div className="flex items-center gap-2 mt-4 text-cyan-400 animate-pulse">
                     <span className="w-2 h-2 bg-cyan-400 rounded-full"></span>
                     Processing...
                   </div>
                 )}
               </div>
            </div>
          </div>

          {/* Control Panel */}
          <div className="flex flex-col gap-6">
            <div className="rounded-[1.5rem] border-[0.75px] border-white/10 bg-black/40 backdrop-blur-md p-6 shadow-xl">
              <h3 className="text-lg font-medium mb-4 text-white/90">Configuration</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-white/50 mb-2 font-semibold">Target Ticker</label>
                  <input 
                    type="text" 
                    value={ticker} 
                    onChange={e => setTicker(e.target.value.toUpperCase())}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50 focus:bg-cyan-500/5 transition-colors uppercase"
                    placeholder="e.g. NVDA"
                    disabled={isRunning}
                  />
                </div>
                
                <button 
                  onClick={startAnalysis}
                  disabled={isRunning || !ticker}
                  className="w-full bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg px-4 py-3 font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(6,182,212,0.2)] hover:shadow-[0_0_25px_rgba(6,182,212,0.4)]"
                >
                  <Send className="w-4 h-4" /> 
                  {isRunning ? 'Analyzing...' : 'Run Agent Protocol'}
                </button>
              </div>
            </div>

            {/* Results Panel */}
            <div className={`rounded-[1.5rem] border-[0.75px] ${reportReady ? 'border-green-500/30 bg-green-500/5' : 'border-white/10 bg-black/40'} backdrop-blur-md p-6 shadow-xl transition-colors duration-500`}>
              <h3 className="text-lg font-medium mb-3 text-white/90">Output Options</h3>
              <p className="text-sm text-white/50 mb-6">Export the agent findings as a raw Markdown file or a client-facing HTML report.</p>
              
              <div className="space-y-3">
                <button 
                  onClick={downloadReport}
                  disabled={!reportReady}
                  className="w-full bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-lg px-4 py-3 font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" /> 
                  Download Markdown Report
                </button>

                <button 
                  onClick={() => setIsHtmlPreviewOpen(true)}
                  disabled={!reportReady}
                  className="w-full bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-300/20 text-cyan-50 rounded-lg px-4 py-3 font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Eye className="w-4 h-4" /> 
                  Preview HTML Report
                </button>

                <button 
                  onClick={downloadHtmlReport}
                  disabled={!reportReady}
                  className="w-full bg-white text-black hover:bg-cyan-50 border border-white rounded-lg px-4 py-3 font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FileText className="w-4 h-4" /> 
                  Download HTML Report
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    {isHtmlPreviewOpen && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-xl pointer-events-auto">
        <div className="w-full max-w-5xl h-[88vh] rounded-2xl border border-white/10 bg-[#111111] shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4 shrink-0">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300/70">HTML Preview</p>
              <h3 className="text-lg font-bold text-white truncate">{ticker} Equity Research Report</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={downloadHtmlReport}
                className="hidden sm:inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15"
              >
                <Download className="w-4 h-4" />
                Download HTML
              </button>
              <button
                onClick={() => setIsHtmlPreviewOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Close HTML preview"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-100 p-3 sm:p-6">
            <article className="mx-auto max-w-4xl border border-slate-200 bg-white shadow-2xl">
              <header className="border-b border-slate-200 px-6 py-7 sm:px-10">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">FinRobot Analyst</p>
                <h1 className="mt-3 text-3xl font-black leading-tight tracking-tight text-slate-950 sm:text-4xl">
                  {ticker} Equity Research Report
                </h1>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-500">
                  <span>Generated: {reportGeneratedAt || "Pending"}</span>
                  <span>Source: TypeScript Multi-Agent Analysis</span>
                </div>
              </header>

              <div className="max-w-none px-6 py-7 text-sm leading-7 text-slate-700 sm:px-10 sm:py-9 [&_a]:font-bold [&_a]:text-cyan-700 [&_blockquote]:border-l-4 [&_blockquote]:border-cyan-500 [&_blockquote]:bg-cyan-50 [&_blockquote]:px-4 [&_blockquote]:py-3 [&_blockquote]:text-cyan-900 [&_code]:rounded [&_code]:border [&_code]:border-slate-200 [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_h1]:mb-5 [&_h1]:text-3xl [&_h1]:font-black [&_h1]:tracking-tight [&_h1]:text-slate-950 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:border-b [&_h2]:border-slate-200 [&_h2]:pb-2 [&_h2]:text-xl [&_h2]:font-black [&_h2]:text-slate-950 [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-black [&_h3]:text-slate-800 [&_hr]:my-7 [&_hr]:border-slate-200 [&_li]:my-1.5 [&_ol]:mb-5 [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:mb-4 [&_pre]:mb-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-slate-950 [&_pre]:p-4 [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-slate-100 [&_strong]:text-slate-950 [&_ul]:mb-5 [&_ul]:ml-5 [&_ul]:list-disc">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {finalReport || `# ${ticker} Equity Research Report\n\nNo report generated.`}
                </ReactMarkdown>
              </div>
            </article>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
