# Agent Framework 復刻藍圖

> **用途**：本文件完整記錄 `daily_stock_analysis` 項目（排除 `mini-project/`）如何從零打造自己的 Agent Framework。  
> 另一個 Agent 讀完此文件後，應能在全新環境中完整復刻整套架構。

---

## 目錄

1. [整體架構概覽](#1-整體架構概覽)
2. [目錄結構](#2-目錄結構)
3. [核心元件詳解](#3-核心元件詳解)
   - 3.1 [Tool Registry — 工具註冊中心](#31-tool-registry--工具註冊中心)
   - 3.2 [Tool 實作 — 三大工具模組](#32-tool-實作--三大工具模組)
   - 3.3 [LLM Adapter — LiteLLM 統一調用層](#33-llm-adapter--litellm-統一調用層)
   - 3.4 [Agent Executor — ReAct 循環引擎](#34-agent-executor--react-循環引擎)
   - 3.5 [Skill System — 可插拔策略系統](#35-skill-system--可插拔策略系統)
   - 3.6 [Factory — 組裝工廠](#36-factory--組裝工廠)
   - 3.7 [Conversation Manager — 多輪對話管理](#37-conversation-manager--多輪對話管理)
4. [ReAct 完整流程圖](#4-react-完整流程圖)
5. [復刻步驟（Step-by-Step）](#5-復刻步驟step-by-step)
6. [環境配置](#6-環境配置)
7. [擴展指南](#7-擴展指南)

---

## 1. 整體架構概覽

```
User Input
    │
    ▼
┌──────────────┐
│   Factory    │ ← 組裝所有元件
│ (factory.py) │
└──────┬───────┘
       │ 建構
       ▼
┌──────────────────────────────────────┐
│         AgentExecutor                │
│         (executor.py)                │
│                                      │
│  ┌────────────┐  ┌────────────────┐  │
│  │ ToolRegistry│  │ LLMToolAdapter │  │
│  │(registry.py)│  │(llm_adapter.py)│  │
│  └──────┬─────┘  └───────┬────────┘  │
│         │                │           │
│    ┌────┴────┐     ┌─────┴─────┐     │
│    │  Tools  │     │  LiteLLM  │     │
│    │ (3 模組) │     │ (任意 LLM) │     │
│    └─────────┘     └───────────┘     │
│                                      │
│  ReAct Loop:                         │
│  Input → LLM → Thought+ToolCall     │
│  → Execute → Observation → LLM      │
│  → ... → Final Answer               │
└──────────────────────────────────────┘
```

**核心設計原則**：
- **LiteLLM 統一接口**：所有 LLM 供應商（Gemini、OpenAI、Anthropic、DeepSeek 等）只透過一個 `litellm.completion()` 調用
- **OpenAI Tool Format 為唯一 Schema**：工具定義只寫一套 OpenAI 格式，LiteLLM 自動轉換到各供應商
- **ReAct Loop**：不斷循環直到 LLM 回傳純文字（Final Answer）或達到 `max_steps`
- **Tool 與 LLM 完全解耦**：新增工具不需改 LLM 層，換 LLM 不需改工具層

---

## 2. 目錄結構

```
src/agent/
├── __init__.py              # Lazy import AgentExecutor, AgentResult
├── executor.py              # ReAct 循環引擎（核心）
├── llm_adapter.py           # LiteLLM 統一 LLM 調用適配器
├── factory.py               # AgentExecutor 組裝工廠
├── conversation.py          # 多輪對話 Session 管理
├── tools/
│   ├── __init__.py          # 匯出 ToolRegistry, ToolDefinition, ToolParameter, @tool
│   ├── registry.py          # ToolRegistry + @tool 裝飾器（核心）
│   ├── data_tools.py        # 數據工具（行情、K線、籌碼、基本面）
│   ├── analysis_tools.py    # 分析工具（趨勢分析、均線計算、量能分析、K線形態）
│   ├── market_tools.py      # 市場工具（大盤指數、板塊排名）
│   └── search_tools.py      # 搜索工具（新聞搜索、綜合情報）
└── skills/
    ├── __init__.py           # 匯出 Skill, SkillManager
    └── base.py               # Skill dataclass + SkillManager（YAML 策略載入）

strategies/                   # YAML 策略文件目錄
├── bull_trend.yaml
├── shrink_pullback.yaml
├── ma_golden_cross.yaml
└── ... (11 個內建策略)
```

---

## 3. 核心元件詳解

### 3.1 Tool Registry — 工具註冊中心

> **檔案**: `src/agent/tools/registry.py`（266 行）

#### 設計模式

Tool Registry 是整個框架的 **工具管理中心**，負責：
1. **註冊 (register)** — 將工具定義加入字典
2. **Schema 生成 (to_openai_tools)** — 把所有工具轉成 OpenAI function calling 格式
3. **執行 (execute)** — 根據工具名稱查找並調用對應的 handler 函數

#### 核心數據結構

```python
@dataclass
class ToolParameter:
    """單個工具參數的 schema。"""
    name: str
    type: str          # "string" | "number" | "integer" | "boolean" | "array" | "object"
    description: str
    required: bool = True
    enum: Optional[List[str]] = None
    default: Any = None


@dataclass
class ToolDefinition:
    """完整的工具定義。"""
    name: str                      # 工具唯一名稱，例如 "get_realtime_quote"
    description: str               # 自然語言描述，LLM 用來決定何時調用
    parameters: List[ToolParameter]
    handler: Callable              # 實際執行函數
    category: str = "data"         # data | analysis | search | market

    def to_openai_tool(self) -> dict:
        """轉成 OpenAI tool format。"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self._params_json_schema(),
            },
        }
```

#### ToolRegistry 類

```python
class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, ToolDefinition] = {}

    def register(self, tool_def: ToolDefinition) -> None:
        """註冊工具。"""
        self._tools[tool_def.name] = tool_def

    def to_openai_tools(self) -> List[dict]:
        """生成 OpenAI format 的工具列表，傳給 LiteLLM。"""
        return [t.to_openai_tool() for t in self._tools.values()]

    def execute(self, name: str, **kwargs) -> Any:
        """根據名稱執行工具，支援 Gemini 的 namespace 格式。"""
        tool_def = self._tools.get(name)
        if tool_def is None and ":" in name:
            tool_def = self._tools.get(name.split(":", 1)[-1])
        if tool_def is None:
            raise KeyError(f"Tool '{name}' not found")
        return tool_def.handler(**kwargs)
```

#### @tool 裝飾器（可選方式）

```python
@tool(name="get_realtime_quote", category="data",
      description="Get real-time stock quote")
def get_realtime_quote(stock_code: str) -> dict:
    ...
```

裝飾器會自動從函數簽名推斷參數類型，然後註冊到全局 registry。  
**本項目主要使用顯式 `ToolDefinition` 實例化方式**，而非裝飾器，因為需要更精確的參數描述。

---

### 3.2 Tool 實作 — 三大工具模組

每個工具模組遵循相同模式：
1. 定義一個 `_handle_xxx()` 函數作為實際 handler
2. 創建一個 `ToolDefinition` 實例，綁定 handler + 參數 schema
3. 匯出 `ALL_XXX_TOOLS` 列表

#### `data_tools.py`（5 個工具）

| 工具名稱 | 類別 | 描述 |
|---------|------|------|
| `get_realtime_quote` | data | 取得即時行情（價格、漲跌、PE、PB、市值） |
| `get_daily_history` | data | 取得歷史 OHLCV K 線數據 |
| `get_chip_distribution` | data | 取得籌碼分布（獲利比例、平均成本、集中度） |
| `get_analysis_context` | data | 從 DB 取得歷史分析上下文 |
| `get_stock_info` | data | 取得基本面資訊（行業、ROE、營收、板塊） |

**實作模式範例**：

```python
def _handle_get_realtime_quote(stock_code: str) -> dict:
    """Handler 函數 — 包裝業務邏輯，返回 dict。"""
    from data_provider import DataFetcherManager  # Lazy import 避免循環依賴
    manager = DataFetcherManager()
    quote = manager.get_realtime_quote(stock_code)
    if quote is None:
        return {"error": f"No realtime quote available for {stock_code}"}
    return {
        "code": quote.code,
        "name": quote.name,
        "price": quote.price,
        "change_pct": quote.change_pct,
        # ... 其他欄位
    }

# ToolDefinition 實例 — 精確定義參數 schema
get_realtime_quote_tool = ToolDefinition(
    name="get_realtime_quote",
    description="Get real-time stock quote including price, change%, volume ratio, "
                "turnover rate, PE, PB, market cap.",
    parameters=[
        ToolParameter(
            name="stock_code",
            type="string",
            description="Stock code, e.g., '600519' (A-share), 'AAPL' (US)",
        ),
    ],
    handler=_handle_get_realtime_quote,
    category="data",
)

# 匯出列表
ALL_DATA_TOOLS = [
    get_realtime_quote_tool,
    get_daily_history_tool,
    get_chip_distribution_tool,
    get_analysis_context_tool,
    get_stock_info_tool,
]
```

#### `analysis_tools.py`（4 個工具）

| 工具名稱 | 類別 | 描述 |
|---------|------|------|
| `analyze_trend` | analysis | 綜合技術趨勢分析（MA排列、MACD、RSI、量能） |
| `calculate_ma` | analysis | 靈活均線計算（任意週期） |
| `get_volume_analysis` | analysis | 量價關係分析 |
| `analyze_pattern` | analysis | K線形態識別（十字星、晨星、吞沒等） |

#### `market_tools.py`（2 個工具）

| 工具名稱 | 類別 | 描述 |
|---------|------|------|
| `get_market_indices` | market | 大盤指數（滬深、美股） |
| `get_sector_rankings` | market | 板塊漲跌排名 |

#### 額外：`search_tools.py`（2 個工具）

| 工具名稱 | 類別 | 描述 |
|---------|------|------|
| `search_stock_news` | search | 搜索最新股票新聞 |
| `search_comprehensive_intel` | search | 多維度情報搜索 |

**關鍵設計要點**：
- Handler 統一返回 `dict`，成功返回數據字典，失敗返回 `{"error": "..."}`
- 使用 **Lazy import** 避免模組載入時的循環依賴
- 每個工具的 `description` 寫給 LLM 看，要清晰說明功能和返回值

---

### 3.3 LLM Adapter — LiteLLM 統一調用層

> **檔案**: `src/agent/llm_adapter.py`（377 行）

#### 核心設計

LLM Adapter 的唯一職責：**將任意 LLM 供應商的 API 差異抹平**，暴露統一的 `call_with_tools()` 接口。

```python
@dataclass
class ToolCall:
    """LLM 請求的一次工具調用。"""
    id: str
    name: str                          # 工具名稱
    arguments: Dict[str, Any]          # 參數字典
    thought_signature: Optional[str] = None  # Gemini 特有

@dataclass
class LLMResponse:
    """標準化的 LLM 回應。"""
    content: Optional[str] = None          # 文字回應（Final Answer）
    tool_calls: List[ToolCall] = field(default_factory=list)   # 工具調用請求
    reasoning_content: Optional[str] = None  # DeepSeek 思維鏈
    usage: Dict[str, Any] = field(default_factory=dict)
    provider: str = ""
    model: str = ""
    raw: Any = None
```

#### LLMToolAdapter 類

```python
class LLMToolAdapter:
    def __init__(self, config=None):
        self._config = config or get_config()
        self._router = None              # litellm Router（多 Key 負載均衡）
        self._litellm_available = False
        self._init_litellm()

    def call_with_tools(self, messages, tools, provider=None) -> LLMResponse:
        """統一調用入口 — 自動 fallback。"""
        models_to_try = [config.litellm_model] + (config.litellm_fallback_models or [])
        for model in models_to_try:
            try:
                return self._call_litellm_model(messages, tools, model)
            except Exception as e:
                continue
        return LLMResponse(content="All models failed", provider="error")

    def _call_litellm_model(self, messages, tools, model) -> LLMResponse:
        """調用單個 litellm model。"""
        openai_messages = self._convert_messages(messages)
        call_kwargs = {
            "model": model,              # 例如 "gemini/gemini-2.0-flash"
            "messages": openai_messages,
            "temperature": self._get_temperature(model),
        }
        if tools:
            call_kwargs["tools"] = tools  # OpenAI format，litellm 自動轉換

        # Router（多 Key）或直接調用
        if self._router:
            response = self._router.completion(**call_kwargs)
        else:
            response = litellm.completion(**call_kwargs)

        return self._parse_litellm_response(response, model)
```

#### 關鍵機制

1. **Message 格式轉換** (`_convert_messages`)
   - 內部使用 provider-neutral 格式
   - 轉成 OpenAI 格式傳給 litellm
   - 處理 `tool` role、`assistant` with `tool_calls`、`reasoning_content` 等特殊情況

2. **Response 解析** (`_parse_litellm_response`)
   - 從 litellm 的 OpenAI-compatible response 提取 tool_calls
   - 解析 JSON arguments
   - 提取 DeepSeek 的 `reasoning_content`
   - 處理 Gemini 的 `thought_signature`

3. **多 Key 負載均衡**
   - 使用 `litellm.Router` 實現多 API Key 輪轉
   - 支持 Channel 模式（多供應商多 Key）和 Legacy 模式（單供應商多 Key）

4. **Model Fallback**
   - `LITELLM_MODEL` 為主模型
   - `LITELLM_FALLBACK_MODELS` 為備選模型列表
   - 主模型失敗自動切換到備選

5. **Thinking Mode 支持**
   - Auto-thinking models（deepseek-reasoner, qwq）：不需要額外參數
   - Opt-in models（deepseek-chat）：需要 `extra_body={"thinking": {"type": "enabled"}}`

---

### 3.4 Agent Executor — ReAct 循環引擎

> **檔案**: `src/agent/executor.py`（691 行）

這是整個框架的 **核心引擎**，實現完整的 ReAct 循環。

#### 初始化

```python
class AgentExecutor:
    def __init__(self, tool_registry, llm_adapter, skill_instructions="", max_steps=10):
        self.tool_registry = tool_registry     # ToolRegistry 實例
        self.llm_adapter = llm_adapter         # LLMToolAdapter 實例
        self.skill_instructions = skill_instructions  # 策略 prompt 文字
        self.max_steps = max_steps             # 最大推理步數
```

#### ReAct 循環流程（`_run_loop` 方法）

```
for step in range(max_steps):
    │
    ├─ 1. 發送 messages + tool_decls 給 LLM
    │     response = self.llm_adapter.call_with_tools(messages, tool_decls)
    │
    ├─ 2. 判斷回應類型
    │     ├── response.tool_calls 非空？ → 進入 Tool Execution
    │     └── response.tool_calls 為空？ → 這是 Final Answer → 結束循環
    │
    ├─ 3. Tool Execution
    │     ├── 把 assistant message（含 tool_calls）加入 messages
    │     ├── 執行工具：
    │     │   ├── 單個工具 → 直接同步執行
    │     │   └── 多個工具 → ThreadPoolExecutor 並行執行
    │     ├── 將工具結果以 tool role 加入 messages
    │     └── 繼續下一次循環
    │
    └─ 4. 超過 max_steps → 返回錯誤
```

#### 兩種入口

1. **`run(task, context)`** — 結構化分析模式
   - 使用 `AGENT_SYSTEM_PROMPT`（包含嚴格的工作流程和 JSON 輸出格式）
   - 返回的 content 會被解析為 Dashboard JSON
   - `parse_dashboard=True`

2. **`chat(message, session_id)`** — 自由對話模式
   - 使用 `CHAT_SYSTEM_PROMPT`（自由回答，不需要 JSON）
   - 支援多輪對話（從 ConversationManager 取得歷史）
   - 支援上下文注入（前次分析數據復用）
   - `parse_dashboard=False`

#### 工具執行細節

```python
def _exec_single_tool(tc_item):
    """執行單個工具，返回 (tc, result_str, success, duration)。"""
    t0 = time.time()
    try:
        res = self.tool_registry.execute(tc_item.name, **tc_item.arguments)
        res_str = self._serialize_tool_result(res)
        ok = True
    except Exception as e:
        res_str = json.dumps({"error": str(e)})
        ok = False
    dur = time.time() - t0
    return tc_item, res_str, ok, round(dur, 2)

# 單工具 → 直接執行（無線程開銷）
# 多工具 → 並行執行（ThreadPoolExecutor, max_workers=5）
```

#### Message 拼裝

```python
# 工具調用的 assistant message
messages.append({
    "role": "assistant",
    "content": response.content,
    "tool_calls": [
        {"id": tc.id, "name": tc.name, "arguments": tc.arguments}
        for tc in response.tool_calls
    ],
})

# 工具結果
messages.append({
    "role": "tool",
    "name": tc.name,
    "tool_call_id": tc.id,
    "content": result_str,     # JSON string
})
```

#### JSON 容錯解析

`_parse_dashboard()` 支援多種 JSON 提取策略：
1. 從 markdown code block 提取
2. 直接 `json.loads()`
3. 使用 `json_repair` 修復
4. 從文字中搜索 `{...}` 子串

---

### 3.5 Skill System — 可插拔策略系統

> **檔案**: `src/agent/skills/base.py`（292 行）

策略系統允許用 **YAML 定義交易策略**，注入到 System Prompt 中影響 LLM 行為。

#### Skill 數據結構

```python
@dataclass
class Skill:
    name: str            # "bull_trend"
    display_name: str    # "默認多頭趨勢"
    description: str     # 適用場景描述
    instructions: str    # 詳細指令（注入到 prompt）
    category: str        # trend | pattern | reversal | framework
    core_rules: List[int]        # 關聯核心理念編號
    required_tools: List[str]    # 依賴的工具名稱
    enabled: bool = False
    source: str = "builtin"
```

#### YAML 策略格式

```yaml
# strategies/bull_trend.yaml
name: bull_trend
display_name: 默認多頭趨勢
description: 識別多頭排列、趨勢延續與回踩低吸機會。
category: trend
core_rules: [1, 2, 3]
required_tools:
  - get_daily_history
  - analyze_trend

instructions: |
  **默認多頭趨勢（Default Bull Trend Strategy）**
  
  分析框架：
  1. **趨勢確認** — 使用 analyze_trend 判斷 MA 排列
  2. **位置與節奏** — 優先回踩不破，避免追高
  3. **量價驗證** — 檢查突破日是否放量
  4. **交易建議** — 明確買入/觀望/減倉
```

#### SkillManager

```python
class SkillManager:
    def load_builtin_strategies(self)    # 從 strategies/ 目錄載入內建策略
    def load_custom_strategies(dir)      # 從自定義目錄載入
    def activate(skill_names)            # 啟用指定策略
    def get_skill_instructions() -> str  # 生成注入 prompt 的文字
```

---

### 3.6 Factory — 組裝工廠

> **檔案**: `src/agent/factory.py`（154 行）

Factory 負責將 ToolRegistry + LLMAdapter + SkillManager 組裝成可用的 AgentExecutor。

```python
def build_agent_executor(config=None, skills=None):
    """一行構建完整的 AgentExecutor。"""
    config = config or get_config()

    # 1. 取得（快取的）工具註冊中心
    registry = get_tool_registry()

    # 2. 取得策略管理器（deepcopy clone）
    skill_manager = get_skill_manager(config)
    skill_manager.activate(skills or DEFAULT_AGENT_SKILLS)

    # 3. 建構 LLM 適配器
    llm_adapter = LLMToolAdapter(config)

    # 4. 組裝 Executor
    return AgentExecutor(
        tool_registry=registry,
        llm_adapter=llm_adapter,
        skill_instructions=skill_manager.get_skill_instructions(),
        max_steps=config.agent_max_steps,
    )
```

**性能優化**：
- `ToolRegistry` 全局快取（工具定義不可變）
- `SkillManager` prototype 模式 + `deepcopy`（每個請求獨立 `activate()` 狀態）

---

### 3.7 Conversation Manager — 多輪對話管理

> **檔案**: `src/agent/conversation.py`（91 行）

```python
@dataclass
class ConversationSession:
    session_id: str
    context: Dict[str, Any]
    created_at: datetime
    last_active: datetime

    def add_message(self, role, content)   # 存入 DB
    def get_history(self) -> List[Dict]    # 從 DB 取歷史

class ConversationManager:
    def __init__(self, ttl_minutes=30)
    def get_or_create(session_id) -> ConversationSession
    def add_message(session_id, role, content)
    def _cleanup_expired()                   # 自動清理過期 session

# 全局單例
conversation_manager = ConversationManager()
```

---

## 4. ReAct 完整流程圖

```
┌─────────────────────────────────────────────────────────────┐
│                     USER INPUT                              │
│  "分析一下茅台600519的走勢"                                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  Step 1: BUILD MESSAGES                                      │
│                                                              │
│  messages = [                                                │
│    {role: "system", content: SYSTEM_PROMPT + skills},        │
│    {role: "user",   content: "分析茅台600519..." }             │
│  ]                                                           │
│                                                              │
│  tool_decls = registry.to_openai_tools()  # 13 個工具定義     │
└──────────────────────┬───────────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │     ReAct LOOP          │
          │    (max 10 steps)       │
          └────────────┬────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  Step 2: CALL LLM                                            │
│                                                              │
│  response = llm_adapter.call_with_tools(messages, tool_decls)│
│                                                              │
│  ↓ 內部：litellm.completion(                                  │
│      model="gemini/gemini-2.0-flash",                        │
│      messages=[...],                                         │
│      tools=[...]    ← OpenAI format, litellm 自動轉換        │
│  )                                                           │
└──────────────────────┬───────────────────────────────────────┘
                       │
              ┌────────┴────────┐
              │                 │
    response.tool_calls    response.content
    非空（要調工具）        非空（最終答案）
              │                 │
              ▼                 ▼
┌─────────────────────┐  ┌──────────────────────┐
│  Step 3: EXECUTE    │  │  Step 5: FINAL       │
│                     │  │                      │
│  for tc in calls:   │  │  parse dashboard     │
│    result = registry│  │  return AgentResult(  │
│      .execute(      │  │    success=True,      │
│        tc.name,     │  │    content=...,       │
│        **tc.args    │  │    dashboard=...,     │
│      )              │  │  )                    │
│                     │  └──────────────────────┘
│  (多工具並行執行)    │
└────────┬────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  Step 4: APPEND TO MESSAGES                                  │
│                                                              │
│  messages.append({                                           │
│    role: "assistant",                                        │
│    tool_calls: [{id, name, arguments}, ...]                  │
│  })                                                          │
│                                                              │
│  for each tool result:                                       │
│    messages.append({                                         │
│      role: "tool",                                           │
│      tool_call_id: tc.id,                                    │
│      name: tc.name,                                          │
│      content: json_string_result                             │
│    })                                                        │
│                                                              │
│  → 回到 Step 2（下一輪 ReAct）                                │
└──────────────────────────────────────────────────────────────┘
```

**典型執行軌跡**（分析 600519 茅台）:

| Step | LLM 決策 | 工具調用 | 說明 |
|------|---------|---------|------|
| 1 | tool_call × 2 | `get_realtime_quote`, `get_daily_history` | 第一階段：行情+K線 |
| 2 | tool_call × 2 | `analyze_trend`, `get_chip_distribution` | 第二階段：技術+籌碼 |
| 3 | tool_call × 1 | `search_stock_news` | 第三階段：情報搜索 |
| 4 | final answer | — | 第四階段：生成分析報告 |

---

## 5. 復刻步驟（Step-by-Step）

### Step 1: 安裝依賴

```bash
pip install litellm json-repair pyyaml
```

### Step 2: 建構 Tool Registry

創建 `tools/registry.py`：
- 定義 `ToolParameter`、`ToolDefinition` dataclasses
- 實現 `ToolRegistry` 類（`register`, `execute`, `to_openai_tools`）
- 實現 `@tool` 裝飾器（可選）
- 關鍵：`to_openai_tools()` 生成的是 OpenAI function calling 格式

### Step 3: 實作工具模組

為你的領域創建對應的工具文件：

```python
# tools/data_tools.py — 項目原文件結構
def _handle_your_tool(param1: str, param2: int = 10) -> dict:
    """實際業務邏輯。"""
    # 調用你的數據源/服務
    result = your_service.fetch(param1, param2)
    if result is None:
        return {"error": f"Failed to fetch {param1}"}
    return {"data": result, "source": "your_source"}

your_tool = ToolDefinition(
    name="your_tool_name",
    description="Clear description for LLM to understand when to use this tool.",
    parameters=[
        ToolParameter(name="param1", type="string", description="..."),
        ToolParameter(name="param2", type="integer", description="...",
                      required=False, default=10),
    ],
    handler=_handle_your_tool,
    category="data",
)

ALL_DATA_TOOLS = [your_tool, ...]
```

**本項目的三個核心模組結構**：

- `data_tools.py`：數據獲取工具（行情、K線、籌碼、基本面、歷史上下文）
- `analysis_tools.py`：分析計算工具（趨勢分析、均線計算、量能分析、K線形態）
- `market_tools.py`：市場概覽工具（大盤指數、板塊排名）

### Step 4: 建構 LLM Adapter

創建 `llm_adapter.py`：

```python
import litellm

class LLMToolAdapter:
    def __init__(self, model="gemini/gemini-2.0-flash", fallbacks=None):
        self.model = model
        self.fallbacks = fallbacks or []

    def call_with_tools(self, messages, tools) -> LLMResponse:
        for model in [self.model] + self.fallbacks:
            try:
                response = litellm.completion(
                    model=model,
                    messages=messages,
                    tools=tools,          # OpenAI format
                    temperature=0.7,
                )
                return self._parse_response(response, model)
            except Exception:
                continue
        return LLMResponse(content="All models failed", provider="error")

    def _parse_response(self, response, model) -> LLMResponse:
        choice = response.choices[0]
        tool_calls = []
        if choice.message.tool_calls:
            for tc in choice.message.tool_calls:
                tool_calls.append(ToolCall(
                    id=tc.id,
                    name=tc.function.name,
                    arguments=json.loads(tc.function.arguments),
                ))
        return LLMResponse(
            content=choice.message.content,
            tool_calls=tool_calls,
            usage={...},
            provider=model.split("/")[0],
            model=model,
        )
```

**LiteLLM model 名稱格式**: `provider/model-name`
- `gemini/gemini-2.0-flash`
- `openai/gpt-4o-mini`
- `anthropic/claude-3-5-sonnet-20241022`
- `deepseek/deepseek-chat`
- OpenRouter: `openrouter/model-name`

### Step 5: 建構 ReAct Executor

創建 `executor.py`：

```python
class AgentExecutor:
    def __init__(self, tool_registry, llm_adapter, system_prompt, max_steps=10):
        self.tool_registry = tool_registry
        self.llm_adapter = llm_adapter
        self.system_prompt = system_prompt
        self.max_steps = max_steps

    def run(self, user_input: str) -> AgentResult:
        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_input},
        ]
        tool_decls = self.tool_registry.to_openai_tools()

        for step in range(self.max_steps):
            # 1. Call LLM
            response = self.llm_adapter.call_with_tools(messages, tool_decls)

            if response.tool_calls:
                # 2. LLM wants tools → execute
                messages.append({
                    "role": "assistant",
                    "content": response.content,
                    "tool_calls": [
                        {"id": tc.id, "type": "function",
                         "function": {"name": tc.name,
                                      "arguments": json.dumps(tc.arguments)}}
                        for tc in response.tool_calls
                    ],
                })
                for tc in response.tool_calls:
                    result = self.tool_registry.execute(tc.name, **tc.arguments)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": json.dumps(result, ensure_ascii=False),
                    })
            else:
                # 3. No tool calls → Final Answer
                return AgentResult(success=True, content=response.content)

        return AgentResult(success=False, error="Max steps exceeded")
```

### Step 6: 組裝 Factory

```python
def build_agent():
    registry = ToolRegistry()
    for tool in ALL_DATA_TOOLS + ALL_ANALYSIS_TOOLS + ALL_MARKET_TOOLS:
        registry.register(tool)

    adapter = LLMToolAdapter(model="gemini/gemini-2.0-flash")
    return AgentExecutor(registry, adapter, SYSTEM_PROMPT)
```

### Step 7: 加入策略系統（可選）

1. 創建 `strategies/` 目錄
2. 寫 YAML 策略文件
3. `SkillManager.load_builtin_strategies()` + `activate()`
4. 將 `skill_instructions` 注入 System Prompt

---

## 6. 環境配置

```bash
# .env 最小配置
LITELLM_MODEL=gemini/gemini-2.0-flash         # 主模型
LITELLM_FALLBACK_MODELS=openai/gpt-4o-mini    # 備選模型（可選）

# API Key（根據 provider 設定）
GEMINI_API_KEY=your_key_here
# 或
OPENAI_API_KEY=sk-xxx
# 或
DEEPSEEK_API_KEY=sk-xxx
# 或 OpenRouter
OPENROUTER_API_KEY=sk-or-xxx

# Agent 配置
AGENT_MODE=true
AGENT_MAX_STEPS=10
AGENT_SKILLS=bull_trend,ma_golden_cross,volume_breakout,shrink_pullback
```

**LiteLLM 支援的環境變數直接讀取**：設定好對應的 `XXX_API_KEY` 環境變數後，litellm 會自動偵測，不需要在程式碼中手動傳入。

---

## 7. 擴展指南

### 新增工具

```python
# 1. 寫 handler
def _handle_my_tool(param: str) -> dict:
    return {"result": "..."}

# 2. 定義 ToolDefinition
my_tool = ToolDefinition(
    name="my_tool",
    description="描述清楚，LLM 才知道何時調用",
    parameters=[ToolParameter(name="param", type="string", description="...")],
    handler=_handle_my_tool,
    category="data",
)

# 3. 加入 ALL_XXX_TOOLS 列表
# 4. factory.py 的 get_tool_registry() 自動載入
```

### 新增 LLM Provider

不需改任何代碼 — LiteLLM 支援 100+ providers。只需：
1. 設定對應的環境變數（`XXX_API_KEY`）
2. 修改 `LITELLM_MODEL` 為新的 `provider/model-name`

### 新增策略

在 `strategies/` 目錄新增 YAML 文件即可，無需任何 Python 代碼。

### 從同步轉非同步

本項目的工具執行使用 `ThreadPoolExecutor` 實現並行。若需完整異步：
- 把 handler 改為 `async def`
- 用 `asyncio.gather()` 替代 `ThreadPoolExecutor`
- 使用 `await litellm.acompletion()` 替代 `litellm.completion()`

---

> **本文件基於 `daily_stock_analysis` 項目的實際源碼編寫，所有程式碼片段均來自生產代碼。**
