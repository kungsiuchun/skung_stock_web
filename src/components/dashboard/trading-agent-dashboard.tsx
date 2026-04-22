"use client";

import { useState } from 'react';
import { Users, Send, Download, Activity, Briefcase } from 'lucide-react';

export function TradingAgentDashboard() {
  const [ticker, setTicker] = useState('NVDA');
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [reportReady, setReportReady] = useState(false);
  const [reports, setReports] = useState<{
    fundamentals_report?: string;
    market_report?: string;
    sentiment_report?: string;
    quant_report?: string;
    manager_report?: string;
  } | null>(null);

  const startAnalysis = async () => {
    if (!ticker) return;
    setIsRunning(true);
    setReportReady(false);
    setReports(null);
    setLogs([
      `[Orchestrator] Initializing Multi-Agent Committee for ${ticker}...`,
      `[Orchestrator] Dispatching Fundamentals Analyst...`,
      `[Orchestrator] Dispatching Market Analyst...`,
      `[Orchestrator] Dispatching Sentiment Analyst...`,
      `[Orchestrator] Dispatching Quant Analyst...`
    ]);
    
    try {
      const res = await fetch("/api/trading-agent/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stock_code: ticker })
      });

      const data = await res.json();
      
      if (data.error || !data.success) {
        setLogs(prev => [...prev, "❌ Error: " + (data.error || "Unknown execution error")]);
      } else {
        setLogs(prev => [
            ...prev, 
            "✅ Analysts complete.",
            "[Portfolio Manager] Synthesizing final recommendation...",
            "✅ Manager report generated!"
        ]);
        
        if (data.results) {
           setReports(data.results);
           setReportReady(true);
        }
      }
    } catch (err: any) {
      setLogs(prev => [...prev, "❌ Terminal Error: Failed to connect to Orchestrator"]);
    } finally {
      setIsRunning(false);
    }
  };

  const downloadReport = () => {
    if (!reports) return;
    const reportContent = `# ${ticker} Trading Agent Committee Report

## 👔 Portfolio Manager Conclusion
${reports.manager_report || "No conclusion provided."}

---

## 📊 Fundamentals Analyst Report
${reports.fundamentals_report || "N/A"}

---

## 📈 Market Analyst Report
${reports.market_report || "N/A"}

---

## 📰 Sentiment Analyst Report
${reports.sentiment_report || "N/A"}

---

## 📐 Quant Analyst Report
${reports.quant_report || "N/A"}
`;
    const blob = new Blob([reportContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ticker}_Committee_Report.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full h-full flex flex-col items-center p-6 sm:p-12 z-10 pointer-events-auto overflow-y-auto text-white">
      <div className="max-w-5xl w-full">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center border border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.3)]">
            <Users className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tighter text-white">Trading Agent Committee</h2>
            <p className="text-white/60">Multi-Role collaboration (Fundamentals, Market, Sentiment & Manager)</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Output Panel */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <div className="rounded-[1.5rem] border-[0.75px] border-white/10 bg-black/40 backdrop-blur-md p-6 h-[500px] flex flex-col shadow-xl">
               <h3 className="text-xl font-semibold mb-4 flex items-center gap-2 text-white/90">
                 <Activity className="w-5 h-5 text-purple-400" /> Consensus Logs
               </h3>
               
               <div className="flex-1 bg-[#0a0f16] rounded-xl border border-white/5 p-4 font-mono text-sm overflow-y-auto text-white/70">
                 {logs.length === 0 ? (
                   <span className="text-white/30 italic">Waiting for ticker assignment...</span>
                 ) : (
                   logs.map((log, i) => (
                     <div key={i} className="mb-2 animate-in fade-in slide-in-from-bottom-2">
                       <span className="text-purple-500/50">[{new Date().toLocaleTimeString()}]</span> {log}
                     </div>
                   ))
                 )}
                 {isRunning && (
                   <div className="flex items-center gap-2 mt-4 text-purple-400 animate-pulse">
                     <span className="w-2 h-2 bg-purple-400 rounded-full"></span>
                     Committee is discussing...
                   </div>
                 )}
               </div>
            </div>
            
            {/* Quick Preview Panel */}
            {reportReady && reports?.manager_report && (
               <div className="rounded-[1.5rem] border-[0.75px] border-purple-500/30 bg-purple-500/5 backdrop-blur-md p-6 shadow-xl overflow-y-auto max-h-[300px]">
                 <h3 className="text-lg font-semibold mb-3 flex items-center gap-2 text-white">
                    <Briefcase className="w-5 h-5 text-purple-400" />
                    Manager Conclusion
                 </h3>
                 <div className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">
                    {reports.manager_report}
                 </div>
               </div>
            )}
          </div>

          {/* Control Panel */}
          <div className="flex flex-col gap-6">
            <div className="rounded-[1.5rem] border-[0.75px] border-white/10 bg-black/40 backdrop-blur-md p-6 shadow-xl">
              <h3 className="text-lg font-medium mb-4 text-white/90">Assignment</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-white/50 mb-2 font-semibold">Target Ticker</label>
                  <input 
                    type="text" 
                    value={ticker} 
                    onChange={e => setTicker(e.target.value.toUpperCase())}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-500/50 focus:bg-purple-500/5 transition-colors uppercase"
                    placeholder="e.g. NVDA"
                    disabled={isRunning}
                  />
                </div>
                
                <button 
                  onClick={startAnalysis}
                  disabled={isRunning || !ticker}
                  className="w-full bg-purple-600 hover:bg-purple-500 text-white rounded-lg px-4 py-3 font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(168,85,247,0.2)] hover:shadow-[0_0_25px_rgba(168,85,247,0.4)]"
                >
                  <Send className="w-4 h-4" /> 
                  {isRunning ? 'Analyzing...' : 'Dispatch Committee'}
                </button>
              </div>
            </div>

            {/* Results Panel */}
            <div className={`rounded-[1.5rem] border-[0.75px] ${reportReady ? 'border-green-500/30 bg-green-500/5' : 'border-white/10 bg-black/40'} backdrop-blur-md p-6 shadow-xl transition-colors duration-500`}>
              <h3 className="text-lg font-medium mb-4 text-white/90">Export Board Report</h3>
              <p className="text-sm text-white/50 mb-6">Download the comprehensive Markdown report containing the manager's decision and all analyst sub-reports.</p>
              
              <button 
                onClick={downloadReport}
                disabled={!reportReady}
                className="w-full bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-lg px-4 py-3 font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" /> 
                Download Full Report
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
