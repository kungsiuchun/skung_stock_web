import { useState, useRef, useEffect } from "react";
import { X, TrendingUp, Loader2, Wrench, Send, Bot, User, Cpu } from "lucide-react";

interface AgentStep {
  step: number;
  type: "tool_call" | "final_answer";
  tool_name?: string;
  tool_args?: Record<string, any>;
  tool_result?: string;
  content?: string;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  steps?: AgentStep[];
  new_memories?: string[];
}

// Simplified history for the API (no steps, just role + content)
interface HistoryMsg {
  role: "user" | "assistant";
  content: string;
}

interface FinanceChatToolProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function FinanceChatTool({ isOpen, onClose }: FinanceChatToolProps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [apiHistory, setApiHistory] = useState<HistoryMsg[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<string>("default");
  const [userMemories, setUserMemories] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Load memories from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("finance_agent_user_memory");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setUserMemories(parsed);
      } catch (e) {
        console.error("Failed to parse user memory", e);
      }
    }
  }, []);

  if (!isOpen) return null;

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || loading) return;

    setInput("");
    setLoading(true);

    // Add user message to UI
    const newMessages: ChatMsg[] = [...messages, { role: "user", content: msg }];
    setMessages(newMessages);

    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          history: apiHistory,
          strategy_mode: selectedStrategy,
          user_memories: userMemories
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to get response");
      }

      // Add assistant reply to UI
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply || "No response.",
          steps: data.steps || [],
          new_memories: data.new_memories || [],
        },
      ]);

      // Update API history
      setApiHistory(data.history || []);

      // Update memories if new ones arrived
      if (data.new_memories && Array.isArray(data.new_memories)) {
        const updatedMemories = [...userMemories, ...data.new_memories];
        // Deduplicate
        const uniqueMemories = Array.from(new Set(updatedMemories));
        setUserMemories(uniqueMemories);
        localStorage.setItem("finance_agent_user_memory", JSON.stringify(uniqueMemories));
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `❌ Error: ${err.message}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    // Don't clear messages so user can resume the conversation
  };

  const handleClear = () => {
    setMessages([]);
    setApiHistory([]);
  };

  const toolStepsFor = (msg: ChatMsg) =>
    (msg.steps || []).filter((s) => s.type === "tool_call");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-auto">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      <div className="bg-[#1C1C1C] border border-white/10 rounded-2xl w-full max-w-2xl relative z-10 shadow-2xl flex flex-col h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Finance Agent Chat</h2>
              <p className="text-white/40 text-xs">ReAct Agent · Multi-turn · Tool Calling</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClear}
              className="text-xs text-white/30 hover:text-white/60 transition-colors px-3 py-1 rounded-lg hover:bg-white/5"
            >
              Clear
            </button>
            <button
              onClick={handleClose}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4 text-white/50" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Welcome message */}
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-4 opacity-60">
              <Bot className="w-12 h-12 text-blue-400/50" />
              <div>
                <p className="text-white/60 text-sm mb-1">Ask me anything about stocks!</p>
                <p className="text-white/30 text-xs">
                  Try: "分析一下 AAPL 的走勢" or "NVDA 值得買嗎？"
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i}>
              {msg.role === "user" ? (
                /* User bubble */
                <div className="flex justify-end">
                  <div className="flex items-start gap-2 max-w-[80%]">
                    <div className="bg-blue-600/80 text-white px-4 py-2.5 rounded-2xl rounded-br-md text-sm leading-relaxed">
                      {msg.content}
                    </div>
                    <div className="w-7 h-7 rounded-full bg-blue-600/30 flex items-center justify-center shrink-0 mt-0.5">
                      <User className="w-3.5 h-3.5 text-blue-300" />
                    </div>
                  </div>
                </div>
              ) : (
                /* Assistant bubble */
                <div className="flex justify-start">
                  <div className="flex items-start gap-2 max-w-[85%]">
                    <div className="w-7 h-7 rounded-full bg-green-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="w-3.5 h-3.5 text-green-400" />
                    </div>
                    <div className="space-y-2">
                      {/* Memory Notification */}
                      {msg.new_memories && msg.new_memories.length > 0 && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-xl mb-1">
                          <TrendingUp className="w-3 h-3 text-blue-400" />
                          <p className="text-[10px] text-blue-300 font-medium">Agent 學習了新記憶: {msg.new_memories[0]}</p>
                        </div>
                      )}
                      {/* Tool calls */}
                      {toolStepsFor(msg).length > 0 && (
                        <div className="space-y-1">
                          {toolStepsFor(msg).map((s, j) => (
                            <details key={j} className="group">
                              <summary className="flex items-center gap-2 px-3 py-1.5 bg-black/30 border border-white/5 rounded-lg cursor-pointer hover:bg-black/50 transition-colors text-xs">
                                <Wrench className="w-3 h-3 text-purple-400" />
                                <code className="text-green-400 font-mono">{s.tool_name}</code>
                                <span className="text-white/20 ml-auto">
                                  {s.tool_args ? JSON.stringify(s.tool_args) : ""}
                                </span>
                              </summary>
                              <pre className="mt-0.5 px-3 py-2 bg-black/20 border border-white/5 rounded-b-lg text-white/40 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap max-h-32">
                                {s.tool_result || "No result"}
                              </pre>
                            </details>
                          ))}
                        </div>
                      )}
                      {/* Reply text */}
                      <div className="bg-white/5 border border-white/5 text-white/90 px-4 py-2.5 rounded-2xl rounded-bl-md text-sm leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Loading indicator */}
          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-white/5 border border-white/5 rounded-2xl rounded-bl-md">
                <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                <span className="text-white/40 text-sm">Thinking & calling tools...</span>
              </div>
            </div>
          )}

        </div>

        <div className="p-4 border-t border-white/10 shrink-0 bg-[#1C1C1C]">
          {/* Strategy Selector */}
          <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1 scrollbar-hide">
            <Cpu className="w-3.5 h-3.5 text-purple-400 shrink-0 mr-1" />
            <span className="text-xs text-white/40 shrink-0 font-medium tracking-wide">分析策略:</span>
            
            <button
              onClick={() => setSelectedStrategy("default")}
              className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors border ${
                selectedStrategy === "default" 
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/30 font-medium" 
                  : "bg-white/5 text-white/50 border-transparent hover:bg-white/10 hover:text-white/70"
              }`}
            >
              🚀 AI 智能分析
            </button>
            <button
              onClick={() => setSelectedStrategy("financial_expert")}
              className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors border ${
                selectedStrategy === "financial_expert" 
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/30 font-medium" 
                  : "bg-white/5 text-white/50 border-transparent hover:bg-white/10 hover:text-white/70"
              }`}
            >
              💎 進階財務分析
            </button>
            <button
              onClick={() => setSelectedStrategy("bull_trend")}
              className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors border ${
                selectedStrategy === "bull_trend" 
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/30 font-medium" 
                  : "bg-white/5 text-white/50 border-transparent hover:bg-white/10 hover:text-white/70"
              }`}
            >
              📈 多頭趨勢 (嚴格量化)
            </button>
            <button
              onClick={() => setSelectedStrategy("ma_golden_cross")}
              className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors border ${
                selectedStrategy === "ma_golden_cross" 
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/30 font-medium" 
                  : "bg-white/5 text-white/50 border-transparent hover:bg-white/10 hover:text-white/70"
              }`}
            >
              ⚔️ 均線金叉 (嚴格量化)
            </button>
            <button
              onClick={() => setSelectedStrategy("shrink_pullback")}
              className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors border ${
                selectedStrategy === "shrink_pullback" 
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/30 font-medium" 
                  : "bg-white/5 text-white/50 border-transparent hover:bg-white/10 hover:text-white/70"
              }`}
            >
              📉 縮量回踩 (嚴格量化)
            </button>
            <button
              onClick={() => setSelectedStrategy("box_oscillation")}
              className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors border ${
                selectedStrategy === "box_oscillation" 
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/30 font-medium" 
                  : "bg-white/5 text-white/50 border-transparent hover:bg-white/10 hover:text-white/70"
              }`}
            >
              📦 箱體震盪 (嚴格量化)
            </button>
            <button
              onClick={() => setSelectedStrategy("volume_breakout")}
              className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors border ${
                selectedStrategy === "volume_breakout" 
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/30 font-medium" 
                  : "bg-white/5 text-white/50 border-transparent hover:bg-white/10 hover:text-white/70"
              }`}
            >
              🚀 放量突破 (嚴格量化)
            </button>
            <button
              onClick={() => setSelectedStrategy("dragon_head")}
              className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors border ${
                selectedStrategy === "dragon_head" 
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/30 font-medium" 
                  : "bg-white/5 text-white/50 border-transparent hover:bg-white/10 hover:text-white/70"
              }`}
            >
              🐲 龍頭策略
            </button>
            <button
              onClick={() => setSelectedStrategy("emotion_cycle")}
              className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors border ${
                selectedStrategy === "emotion_cycle" 
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/30 font-medium" 
                  : "bg-white/5 text-white/50 border-transparent hover:bg-white/10 hover:text-white/70"
              }`}
            >
              🎭 情緒週期
            </button>
            <button
              onClick={() => setSelectedStrategy("chan_theory")}
              className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors border ${
                selectedStrategy === "chan_theory" 
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/30 font-medium" 
                  : "bg-white/5 text-white/50 border-transparent hover:bg-white/10 hover:text-white/70"
              }`}
            >
              🌀 纏論策略
            </button>
            <button
              onClick={() => setSelectedStrategy("wave_theory")}
              className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors border ${
                selectedStrategy === "wave_theory" 
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/30 font-medium" 
                  : "bg-white/5 text-white/50 border-transparent hover:bg-white/10 hover:text-white/70"
              }`}
            >
              🌊 波浪理論
            </button>
            <button
              onClick={() => setSelectedStrategy("one_yang_three_yin")}
              className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors border ${
                selectedStrategy === "one_yang_three_yin" 
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/30 font-medium" 
                  : "bg-white/5 text-white/50 border-transparent hover:bg-white/10 hover:text-white/70"
              }`}
            >
              🔥 一陽夾三陰
            </button>
            <button
              onClick={() => setSelectedStrategy("bottom_volume")}
              className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors border ${
                selectedStrategy === "bottom_volume" 
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/30 font-medium" 
                  : "bg-white/5 text-white/50 border-transparent hover:bg-white/10 hover:text-white/70"
              }`}
            >
              📉 底部放量
            </button>
          </div>

          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Type your question... (e.g. 分析 TSLA)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              disabled={loading}
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-5 py-3 rounded-xl font-bold transition-colors flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
