"use client";

import { useState } from 'react';
import { Bot, Send, Download, Activity } from 'lucide-react';

export function FinRobotDashboard() {
  const [ticker, setTicker] = useState('NVDA');
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [reportReady, setReportReady] = useState(false);
  const [finalReport, setFinalReport] = useState<string>('');

  const startAnalysis = async () => {
    if (!ticker) return;
    setIsRunning(true);
    setReportReady(false);
    setFinalReport('');
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

  return (
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
              <h3 className="text-lg font-medium mb-4 text-white/90">Output Options</h3>
              <p className="text-sm text-white/50 mb-6">Generate downloadable Markdown markdown analysis based on agent findings.</p>
              
              <button 
                onClick={downloadReport}
                disabled={!reportReady}
                className="w-full bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-lg px-4 py-3 font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" /> 
                Download Markdown Report
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
