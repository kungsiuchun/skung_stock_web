"use client";

import { useState } from "react";
import { Activity, Bot, Briefcase, Download, FileText, Landmark, Send, ShieldCheck, Users } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type AgentMode = "trading" | "buffett" | "finrobot";

type TradingReports = {
  fundamentals_report?: string;
  market_report?: string;
  sentiment_report?: string;
  quant_report?: string;
  manager_report?: string;
};

const AGENT_OPTIONS: Record<
  AgentMode,
  {
    title: string;
    shortTitle: string;
    description: string;
    accent: string;
    button: string;
    icon: typeof Users;
    startLog: (ticker: string) => string[];
  }
> = {
  trading: {
    title: "Trading Agent Committee",
    shortTitle: "Trading",
    description: "Multi-role trading decision using fundamentals, market, sentiment, quant, and manager synthesis.",
    accent: "purple",
    button: "Dispatch Committee",
    icon: Users,
    startLog: (ticker) => [
      `[Orchestrator] Initializing Multi-Agent Committee for ${ticker}...`,
      "[Orchestrator] Dispatching Fundamentals Analyst...",
      "[Orchestrator] Dispatching Market Analyst...",
      "[Orchestrator] Dispatching Sentiment Analyst...",
      "[Orchestrator] Dispatching Quant Analyst...",
    ],
  },
  buffett: {
    title: "Buffett Quality Auditor",
    shortTitle: "Buffett",
    description: "Long-term quality review that forces moat, cash flow, management, and margin-of-safety checks.",
    accent: "emerald",
    button: "Run Quality Review",
    icon: ShieldCheck,
    startLog: (ticker) => [
      `[Quality Auditor] Starting Buffett-style review for ${ticker}...`,
      "[Quality Auditor] Forcing good-business, moat, cash-flow, management, and margin-of-safety checks...",
      "[Quality Auditor] Gathering financial summary, price context, and recent evidence...",
    ],
  },
  finrobot: {
    title: "FinRobot Analyst",
    shortTitle: "FinRobot",
    description: "Full equity research report using the existing Perception -> Brain -> Action workflow.",
    accent: "cyan",
    button: "Run Research Agent",
    icon: Bot,
    startLog: (ticker) => [
      `[Director Agent] Initializing FinRobot analysis for ${ticker}...`,
      "[Perception Agent] Gathering fundamentals, price, strategy, sentiment, and catalysts...",
    ],
  },
};

const getAccentClasses = (mode: AgentMode) => {
  if (mode === "buffett") {
    return {
      glow: "bg-emerald-500/20 border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.3)]",
      icon: "text-emerald-400",
      active: "border-emerald-400/60 bg-emerald-500/15 text-white",
      focus: "focus:border-emerald-500/50 focus:bg-emerald-500/5",
      button: "bg-emerald-600 hover:bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_25px_rgba(16,185,129,0.4)]",
      pulse: "text-emerald-400",
      dot: "bg-emerald-400",
      stamp: "text-emerald-500/50",
    };
  }

  if (mode === "finrobot") {
    return {
      glow: "bg-cyan-500/20 border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.3)]",
      icon: "text-cyan-400",
      active: "border-cyan-400/60 bg-cyan-500/15 text-white",
      focus: "focus:border-cyan-500/50 focus:bg-cyan-500/5",
      button: "bg-cyan-600 hover:bg-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.2)] hover:shadow-[0_0_25px_rgba(6,182,212,0.4)]",
      pulse: "text-cyan-400",
      dot: "bg-cyan-400",
      stamp: "text-cyan-500/50",
    };
  }

  return {
    glow: "bg-purple-500/20 border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.3)]",
    icon: "text-purple-400",
    active: "border-purple-400/60 bg-purple-500/15 text-white",
    focus: "focus:border-purple-500/50 focus:bg-purple-500/5",
    button: "bg-purple-600 hover:bg-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.2)] hover:shadow-[0_0_25px_rgba(168,85,247,0.4)]",
    pulse: "text-purple-400",
    dot: "bg-purple-400",
    stamp: "text-purple-500/50",
  };
};

const buildTradingReport = (ticker: string, reports: TradingReports) => `# ${ticker} Trading Agent Committee Report

## Portfolio Manager Conclusion
${reports.manager_report || "No conclusion provided."}

---

## Fundamentals Analyst Report
${reports.fundamentals_report || "N/A"}

---

## Market Analyst Report
${reports.market_report || "N/A"}

---

## Sentiment Analyst Report
${reports.sentiment_report || "N/A"}

---

## Quant Analyst Report
${reports.quant_report || "N/A"}
`;

export function TradingAgentDashboard() {
  const [ticker, setTicker] = useState("NVDA");
  const [selectedAgent, setSelectedAgent] = useState<AgentMode>("trading");
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [reportReady, setReportReady] = useState(false);
  const [reports, setReports] = useState<TradingReports | null>(null);
  const [singleReport, setSingleReport] = useState("");

  const profile = AGENT_OPTIONS[selectedAgent];
  const Icon = profile.icon;
  const accent = getAccentClasses(selectedAgent);

  const startAnalysis = async () => {
    const targetTicker = ticker.trim().toUpperCase();
    if (!targetTicker) return;

    setTicker(targetTicker);
    setIsRunning(true);
    setReportReady(false);
    setReports(null);
    setSingleReport("");
    setLogs(profile.startLog(targetTicker));

    try {
      if (selectedAgent === "trading") {
        const res = await fetch("/api/trading-agent/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stock_code: targetTicker }),
        });

        const data = await res.json();

        if (data.error || !data.success) {
          setLogs((prev) => [...prev, "Error: " + (data.error || "Unknown execution error")]);
          return;
        }

        setLogs((prev) => [
          ...prev,
          "Analysts complete.",
          "[Portfolio Manager] Synthesizing final recommendation...",
          "Manager report generated.",
        ]);

        if (data.results) {
          setReports(data.results);
          setReportReady(true);
        }
        return;
      }

      const res = await fetch("/api/finrobot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: targetTicker, agentProfile: selectedAgent }),
      });

      const data = await res.json();

      if (data.error || data.success === false) {
        setLogs((prev) => [...prev, "Error: " + (data.error || "Unknown execution error")]);
        return;
      }

      if (data.steps && data.steps.length > 0) {
        data.steps.forEach((step: any) => {
          if (step.type === "tool_call") {
            setLogs((prev) => [...prev, `[Perception Agent] Used tool: ${step.tool_name}`]);
          }
        });
      }

      setSingleReport(data.report || "No report generated.");
      setReportReady(true);
      setLogs((prev) => [...prev, `${data.agentLabel || profile.title} report generated.`]);
    } catch (_err: any) {
      setLogs((prev) => [...prev, "Terminal Error: Failed to connect to Analysis Agent"]);
    } finally {
      setIsRunning(false);
    }
  };

  const getCurrentReport = () => {
    if (selectedAgent === "trading") {
      return reports ? buildTradingReport(ticker, reports) : "";
    }

    return singleReport;
  };

  const downloadReport = () => {
    const reportContent = getCurrentReport();
    if (!reportContent) return;

    const blob = new Blob([reportContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ticker}_${selectedAgent}_Report.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full h-full flex flex-col items-center p-6 sm:p-12 z-10 pointer-events-auto overflow-y-auto text-white">
      <div className="max-w-6xl w-full">
        <div className="flex items-center gap-4 mb-8">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${accent.glow}`}>
            <Icon className={`w-6 h-6 ${accent.icon}`} />
          </div>
          <div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tighter text-white">{profile.title}</h2>
            <p className="text-white/60">{profile.description}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 flex flex-col gap-6">
            <div className="rounded-[1.5rem] border-[0.75px] border-white/10 bg-black/40 backdrop-blur-md p-6 h-[500px] flex flex-col shadow-xl">
              <h3 className="text-xl font-semibold mb-4 flex items-center gap-2 text-white/90">
                <Activity className={`w-5 h-5 ${accent.icon}`} /> Agent Execution Logs
              </h3>

              <div className="flex-1 bg-[#0a0f16] rounded-xl border border-white/5 p-4 font-mono text-sm overflow-y-auto text-white/70">
                {logs.length === 0 ? (
                  <span className="text-white/30 italic">Waiting for ticker assignment...</span>
                ) : (
                  logs.map((log, i) => (
                    <div key={`${log}-${i}`} className="mb-2 animate-in fade-in slide-in-from-bottom-2">
                      <span className={accent.stamp}>[{new Date().toLocaleTimeString()}]</span> {log}
                    </div>
                  ))
                )}
                {isRunning && (
                  <div className={`flex items-center gap-2 mt-4 ${accent.pulse} animate-pulse`}>
                    <span className={`w-2 h-2 rounded-full ${accent.dot}`}></span>
                    Agent is working...
                  </div>
                )}
              </div>
            </div>

            {reportReady && (
              <div className="rounded-[1.5rem] border-[0.75px] border-white/10 bg-white/[0.04] backdrop-blur-md p-6 shadow-xl overflow-y-auto max-h-[420px]">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2 text-white">
                  <Briefcase className={`w-5 h-5 ${accent.icon}`} />
                  Report Preview
                </h3>
                <div className="prose prose-invert prose-sm max-w-none text-white/80 prose-headings:text-white prose-strong:text-white prose-a:text-cyan-300">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{getCurrentReport()}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-6">
            <div className="rounded-[1.5rem] border-[0.75px] border-white/10 bg-black/40 backdrop-blur-md p-6 shadow-xl">
              <h3 className="text-lg font-medium mb-4 text-white/90">Agent Type</h3>

              <div className="grid grid-cols-3 gap-2 mb-5">
                {(Object.keys(AGENT_OPTIONS) as AgentMode[]).map((mode) => {
                  const OptionIcon = AGENT_OPTIONS[mode].icon;
                  const isActive = selectedAgent === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        if (isRunning) return;
                        setSelectedAgent(mode);
                        setReportReady(false);
                        setReports(null);
                        setSingleReport("");
                        setLogs([]);
                      }}
                      className={`h-20 rounded-lg border px-2 text-xs font-semibold transition-all flex flex-col items-center justify-center gap-1 ${
                        isActive ? getAccentClasses(mode).active : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10 hover:text-white"
                      }`}
                      disabled={isRunning}
                    >
                      <OptionIcon className="w-4 h-4" />
                      <span>{AGENT_OPTIONS[mode].shortTitle}</span>
                    </button>
                  );
                })}
              </div>

              {selectedAgent === "buffett" && (
                <div className="mb-5 rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-3 text-xs leading-5 text-emerald-50/80">
                  <div className="mb-2 flex items-center gap-2 font-bold text-emerald-200">
                    <Landmark className="w-4 h-4" />
                    Mandatory checks
                  </div>
                  <div>Good business / Moat / Cash flow / Management / Margin of safety</div>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-white/50 mb-2 font-semibold">Target Ticker</label>
                  <input
                    type="text"
                    value={ticker}
                    onChange={(e) => setTicker(e.target.value.toUpperCase())}
                    className={`w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none transition-colors uppercase ${accent.focus}`}
                    placeholder="e.g. NVDA"
                    disabled={isRunning}
                  />
                </div>

                <button
                  onClick={startAnalysis}
                  disabled={isRunning || !ticker}
                  className={`w-full text-white rounded-lg px-4 py-3 font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${accent.button}`}
                >
                  <Send className="w-4 h-4" />
                  {isRunning ? "Analyzing..." : profile.button}
                </button>
              </div>
            </div>

            <div className={`rounded-[1.5rem] border-[0.75px] ${reportReady ? "border-green-500/30 bg-green-500/5" : "border-white/10 bg-black/40"} backdrop-blur-md p-6 shadow-xl transition-colors duration-500`}>
              <h3 className="text-lg font-medium mb-4 text-white/90">Export Report</h3>
              <p className="text-sm text-white/50 mb-6">
                Download the selected agent's Markdown report. Buffett mode is for long-term quality review, not trade timing.
              </p>

              <button
                onClick={downloadReport}
                disabled={!reportReady}
                className="w-full bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-lg px-4 py-3 font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                Download Markdown
              </button>
            </div>

            <div className="rounded-[1.5rem] border-[0.75px] border-white/10 bg-black/40 backdrop-blur-md p-6 shadow-xl">
              <h3 className="text-lg font-medium mb-3 flex items-center gap-2 text-white/90">
                <FileText className={`w-5 h-5 ${accent.icon}`} />
                Decision Lens
              </h3>
              <p className="text-sm text-white/50">{profile.description}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
