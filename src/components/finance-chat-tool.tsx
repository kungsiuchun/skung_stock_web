import { useEffect, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  Cpu,
  Loader2,
  Send,
  TrendingUp,
  User,
  Wrench,
  X,
} from "lucide-react";

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

interface HistoryMsg {
  role: "user" | "assistant";
  content: string;
}

interface FinanceChatToolProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FinanceChatPanelProps {
  onClose?: () => void;
  className?: string;
  title?: string;
  subtitle?: string;
}

const STRATEGY_OPTIONS = [
  { value: "default", label: "AI 智能分析", hint: "General ReAct analysis" },
  { value: "financial_expert", label: "進階財務分析", hint: "Fundamentals + options" },
  { value: "bull_trend", label: "多頭趨勢", hint: "Strict quant trend" },
  { value: "ma_golden_cross", label: "均線金叉", hint: "MA crossover" },
  { value: "shrink_pullback", label: "縮量回踩", hint: "Pullback setup" },
  { value: "box_oscillation", label: "箱體震盪", hint: "Range behavior" },
  { value: "volume_breakout", label: "放量突破", hint: "Breakout volume" },
  { value: "dragon_head", label: "龍頭策略", hint: "Leadership setup" },
  { value: "emotion_cycle", label: "情緒週期", hint: "Sentiment cycle" },
  { value: "chan_theory", label: "纏論策略", hint: "Chan structure" },
  { value: "wave_theory", label: "波浪理論", hint: "Wave structure" },
  { value: "one_yang_three_yin", label: "一陽夾三陰", hint: "Pattern scan" },
  { value: "bottom_volume", label: "底部放量", hint: "Bottoming volume" },
] as const;

export function FinanceChatPanel({
  onClose,
  className = "",
  title = "Finance Agent Chat",
  subtitle = "ReAct Agent · Multi-turn · Tool Calling",
}: FinanceChatPanelProps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [apiHistory, setApiHistory] = useState<HistoryMsg[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<string>("default");
  const [userMemories, setUserMemories] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedStrategyMeta =
    STRATEGY_OPTIONS.find((item) => item.value === selectedStrategy) ?? STRATEGY_OPTIONS[0];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    const saved = localStorage.getItem("finance_agent_user_memory");
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) setUserMemories(parsed);
    } catch (e) {
      console.error("Failed to parse user memory", e);
    }
  }, []);

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || loading) return;

    setInput("");
    setLoading(true);

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
          user_memories: userMemories,
          surface: "finance_chat",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to get response");
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply || "No response.",
          steps: data.steps || [],
          new_memories: data.new_memories || [],
        },
      ]);

      setApiHistory(data.history || []);

      if (data.new_memories && Array.isArray(data.new_memories)) {
        const uniqueMemories = Array.from(new Set([...userMemories, ...data.new_memories]));
        setUserMemories(uniqueMemories);
        localStorage.setItem("finance_agent_user_memory", JSON.stringify(uniqueMemories));
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${err.message}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([]);
    setApiHistory([]);
  };

  const toolStepsFor = (msg: ChatMsg) => (msg.steps || []).filter((s) => s.type === "tool_call");

  return (
    <section
      className={`flex h-full min-h-[640px] flex-col overflow-hidden bg-[#11151c] text-white ${className}`}
      aria-label="Finance Agent Chat"
    >
      <div className="flex shrink-0 flex-col gap-4 border-b border-white/10 px-4 py-4 sm:px-5 lg:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-black tracking-tight text-white sm:text-lg">{title}</h2>
              <p className="mt-0.5 truncate text-xs font-medium text-white/45">{subtitle}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={handleClear}
              className="rounded-lg px-3 py-2 text-xs font-bold text-white/45 transition-colors hover:bg-white/10 hover:text-white"
              type="button"
            >
              Clear
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                type="button"
                aria-label="Close chat"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-2 rounded-xl border border-white/10 bg-black/20 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(190px,240px)] sm:items-center">
          <div className="flex min-w-0 items-center gap-2">
            <Cpu className="h-4 w-4 shrink-0 text-purple-300" />
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">Analysis Strategy</p>
              <p className="truncate text-xs font-bold text-white">{selectedStrategyMeta.label}</p>
            </div>
          </div>
          <label className="relative block">
            <span className="sr-only">Analysis strategy</span>
            <select
              value={selectedStrategy}
              onChange={(e) => setSelectedStrategy(e.target.value)}
              className="h-10 w-full appearance-none rounded-lg border border-white/10 bg-[#1b2230] px-3 pr-9 text-xs font-bold text-white outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30"
            >
              {STRATEGY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} - {option.hint}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" />
          </label>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 sm:px-5 lg:px-6">
        {messages.length === 0 && (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-300">
              <Bot className="h-8 w-8" />
            </div>
            <div>
              <p className="text-sm font-bold text-white/75">Ask me anything about stocks.</p>
              <p className="mt-1 text-xs font-medium text-white/35">
                Try: "分析 MSFT" or "NVDA 值唔值得買?"
              </p>
            </div>
          </div>
        )}

        <div className="space-y-5">
          {messages.map((msg, i) => (
            <div key={`${msg.role}-${i}`} className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}>
              {msg.role === "user" ? (
                <div className="flex max-w-[86%] items-start gap-2 lg:max-w-[74%]">
                  <div className="rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-sm font-medium leading-relaxed text-white">
                    {msg.content}
                  </div>
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/20 text-blue-200">
                    <User className="h-4 w-4" />
                  </div>
                </div>
              ) : (
                <div className="flex w-full max-w-[95%] items-start gap-3 xl:max-w-[88%]">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    {msg.new_memories && msg.new_memories.length > 0 && (
                      <div className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-[11px] font-bold text-blue-200">
                        Agent learned: {msg.new_memories[0]}
                      </div>
                    )}

                    {toolStepsFor(msg).length > 0 && (
                      <div className="space-y-1.5">
                        {toolStepsFor(msg).map((s, j) => (
                          <details key={`${s.tool_name}-${j}`} className="group rounded-xl border border-white/10 bg-black/20">
                            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs">
                              <Wrench className="h-3.5 w-3.5 shrink-0 text-purple-300" />
                              <code className="min-w-0 truncate font-mono text-emerald-300">{s.tool_name}</code>
                              <span className="ml-auto max-w-[42%] truncate text-[10px] text-white/35">
                                {s.tool_args ? JSON.stringify(s.tool_args) : ""}
                              </span>
                            </summary>
                            <pre className="max-h-56 overflow-auto border-t border-white/10 px-3 py-3 text-[11px] leading-relaxed text-white/55">
                              {s.tool_result || "No result"}
                            </pre>
                          </details>
                        ))}
                      </div>
                    )}

                    <div className="whitespace-pre-wrap rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.06] px-4 py-3 text-sm leading-relaxed text-white/90">
                      {msg.content}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.06] px-4 py-2.5">
                <Loader2 className="h-4 w-4 animate-spin text-blue-300" />
                <span className="text-sm font-medium text-white/45">Thinking and calling tools...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-white/10 bg-[#11151c] px-4 py-4 sm:px-5 lg:px-6">
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Type your question... (e.g. 分析 MSFT)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-medium text-white outline-none transition placeholder:text-white/25 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30"
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}

export default function FinanceChatTool({ isOpen, onClose }: FinanceChatToolProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-label="Close chat" />
      <FinanceChatPanel onClose={onClose} className="relative z-10 h-[88vh] w-full max-w-5xl rounded-2xl border border-white/10 shadow-2xl" />
    </div>
  );
}
